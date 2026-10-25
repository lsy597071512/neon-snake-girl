# -*- coding: utf-8 -*-
"""webm 贴图编辑器：把 PNG 贴图叠加到视频的指定区域（关键帧动画）。

本文件保证输出的 webm 与源文件的 **编码格式 / 分辨率 / 帧率 / 像素格式** 完全一致。
工具不读取源其它流，导出的所有处理都在内存里完成。

工作流程
  1. 打开一个源 .webm
  2. 导入 PNG 贴图（支持透明）
  3. 在画布上拖动/缩放/旋转贴图，放到目标位置
  4. 打关键帧；在关键帧之间自动线性插值位置/缩放/旋转/透明度
  5. 导出为新 .webm。默认走零落盘管道，极快且不压画质。

用法
  python -u scripts/webm_sticker_editor.py
  python -u scripts/webm_sticker_editor.py --input tex/juese/pifu/dandu/SR01_2_dandu.webm

无 GUI 导出（用已渲染好的项目 JSON）：
  python -u scripts/webm_sticker_editor.py --project proj.json --export out.webm
"""
from __future__ import annotations

import argparse
import atexit
import collections
import ctypes
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field, asdict, replace
from pathlib import Path

from PIL import Image, ImageTk

def _resolve_tool(name: str) -> str:
    """定位 ffmpeg/ffprobe 可执行文件。

    打包后的 EXE 依赖 PATH 找 ffmpeg；但从资源管理器双击启动时 PATH 可能不含
    ffmpeg 目录（本机装在 WinGet 的 packages 路径下，WinGet 通常会写 PATH，
    但用户级 PATH 未生效的机器很常见）。找不到时抛清晰的错，
    否则会以「解码器 20s 没有输出第一帧」这种误导性信息表现出来。
    """
    exe = name + '.exe' if os.name == 'nt' else name
    found = shutil.which(exe) or shutil.which(name)
    if found:
        return found
    # 常见安装位置兜底（WinGet / scoop / choco）
    roots = [
        os.environ.get('LOCALAPPDATA', ''),
        os.environ.get('ProgramFiles', ''),
        os.environ.get('ProgramW6432', ''),
    ]
    pat_glob = os.path.join('Microsoft', 'WinGet', 'Packages', '*', 'ffmpeg-*', 'bin')
    for root in roots:
        if not root:
            continue
        base = os.path.join(root, pat_glob) if os.name == 'nt' else os.path.join(root, '**', 'bin')
        try:
            for hit in glob.glob(base):
                cand = os.path.join(hit, exe)
                if os.path.exists(cand):
                    return cand
        except Exception:
            continue
    raise FileNotFoundError(
        f'找不到 {name}。请把 ffmpeg 加入 PATH，或安装后重开本程序。\n'
        f'（本工具依赖 ffmpeg/ffprobe 解码与封装 webm）')


def _tool(name: str) -> str:
    """惰性解析并缓存工具路径；失败时抛出可读错误而不是静默卡死。"""
    global _TOOL_CACHE
    if name in _TOOL_CACHE:
        return _TOOL_CACHE[name]
    resolved = _resolve_tool(name)
    _TOOL_CACHE[name] = resolved
    return resolved


_TOOL_CACHE: dict[str, str] = {}


def _no_window() -> int:
    """windowed EXE 必须切断控制台继承，否则子进程管道永久阻塞。"""
    if os.name != 'nt':
        return 0
    return getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def _run(cmd: list[str], **kw):
    """统一入口：所有 ffmpeg/ffprobe 调用都走这里，自动带 CREATE_NO_WINDOW。"""
    kw.setdefault('creationflags', _no_window())
    return subprocess.run(cmd, **kw)


def _popen(cmd: list[str], **kw):
    kw.setdefault('creationflags', _no_window())
    return subprocess.Popen(cmd, **kw)


FFMPEG = 'ffmpeg'
FFPROBE = 'ffprobe'

# 帧率钳制：r_frame_rate 经常是野值（如 1000/1），超过该值一律视为不可信。
MAX_TRUSTED_FPS = 240.0
# 预览解码时，PNG 帧数相对容器包数的允许膨胀比（防帧爆炸 weld）。
DECODE_OVERRUN_RATIO = 1.02
DECODE_OVERRUN_SLACK = 4


class _SafeOut:
    """永不抛异常的输出：目标失效就摘掉。frozen 窗口版 EXE 没有控制台，
    管道随时会断，用它包裹 stdout/stderr 防止 print 崩掉整个程序。"""

    def __init__(self, targets=()) -> None:
        self.targets = list(targets)

    def write(self, s) -> int:
        for t in list(self.targets):
            try:
                t.write(s)
            except Exception:
                try:
                    self.targets.remove(t)
                except ValueError:
                    pass
        return len(s) if isinstance(s, str) else 0

    def flush(self) -> None:
        for t in list(self.targets):
            try:
                t.flush()
            except Exception:
                pass


def _setup_frozen_io() -> None:
    if not getattr(sys, 'frozen', False):
        return
    try:
        log = Path(sys.executable).with_name('WebmStickerEditor.log')
        f = open(log, 'a', encoding='utf-8')
        safe = _SafeOut([sys.stdout, f])
        sys.stdout = safe
        sys.stderr = _SafeOut([sys.stderr, f])
    except OSError:
        pass


# ---------------------------------------------------------------- Win32 拖放

WM_DROPFILES = 0x233
GWL_WNDPROC = -4
GA_ROOT = 2


def _win32_api():
    """64-bit 安全的 Win32 声明。ctypes.windll 默认 restype 是 32-bit int，
    64-bit 下 HWND/指针会被截断——上一版的卡死就是这么来的。"""
    u = ctypes.windll.user32
    s = ctypes.windll.shell32
    u.IsWindow.restype = ctypes.c_int
    u.IsWindow.argtypes = [ctypes.c_void_p]
    u.GetAncestor.restype = ctypes.c_void_p
    u.GetAncestor.argtypes = [ctypes.c_void_p, ctypes.c_uint]
    u.SetWindowLongPtrW.restype = ctypes.c_ssize_t
    u.SetWindowLongPtrW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_ssize_t]
    u.CallWindowProcW.restype = ctypes.c_ssize_t
    u.CallWindowProcW.argtypes = [ctypes.c_ssize_t, ctypes.c_void_p, ctypes.c_uint,
                                  ctypes.c_void_p, ctypes.c_void_p]
    u.DefWindowProcW.restype = ctypes.c_ssize_t
    u.DefWindowProcW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
    s.DragAcceptFiles.restype = None
    s.DragAcceptFiles.argtypes = [ctypes.c_void_p, ctypes.c_int]
    s.DragQueryFileW.restype = ctypes.c_uint
    s.DragQueryFileW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_wchar_p, ctypes.c_uint]
    s.DragFinish.restype = None
    s.DragFinish.argtypes = [ctypes.c_void_p]
    return u, s


class FolderDropTarget:
    """把文件/文件夹直接拖到窗口上。

    tkinter 本身没有 DnD，这里子类化窗口过程接收 WM_DROPFILES。
    必须挂在 Tk toplevel 的*外框* HWND 上，挂错窗口会破坏消息链。

    关键设计：wndproc 里**只取路径、塞进 pending 队列、立刻返回**，
    绝不碰任何 Tk/Python 回调。Tk 侧用 after 轮询把路径捞出来处理。
    直接在消息分发中途调 root.after 之类，是冻结版 exe 闪退的根因。
    """

    def __init__(self, hwnd: int) -> None:
        self.hwnd = hwnd
        self.pending: collections.deque[str] = collections.deque()
        self._old: int = 0
        self._cb = None

    def _wndproc(self, hwnd, msg, wparam, lparam):
        try:
            if msg == WM_DROPFILES:
                _, sh = _win32_api()
                n = sh.DragQueryFileW(wparam, 0xFFFFFFFF, None, 0)
                for i in range(n):
                    buf = ctypes.create_unicode_buffer(32768)
                    if sh.DragQueryFileW(wparam, i, buf, 32768):
                        self.pending.append(buf.value)
                sh.DragFinish(wparam)
                return 0
        except Exception:
            pass
        try:
            u, _ = _win32_api()
            if self._old:
                return u.CallWindowProcW(self._old, hwnd, msg, wparam, lparam)
            return u.DefWindowProcW(hwnd, msg, wparam, lparam)
        except Exception:
            return 0

    def _install(self) -> None:
        u, sh = _win32_api()
        proto = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_void_p, ctypes.c_uint,
                                   ctypes.c_void_p, ctypes.c_void_p)
        self._cb = proto(self._wndproc)
        old = u.SetWindowLongPtrW(ctypes.c_void_p(self.hwnd), GWL_WNDPROC,
                                  ctypes.cast(self._cb, ctypes.c_void_p).value)
        if not old:
            raise RuntimeError('SetWindowLongPtrW 返回 NULL，窗口过程挂钩失败')
        self._old = old
        sh.DragAcceptFiles(ctypes.c_void_p(self.hwnd), 1)


def _toplevel_hwnd(root) -> int:
    """拿到 Tk 根窗口的外框 HWND。优先 wm_frame，失败则沿 GetAncestor 上找根。"""
    try:
        frame = root.wm_frame()
        return int(str(frame), 16)
    except Exception:
        pass
    try:
        u, _ = _win32_api()
        child = ctypes.c_void_p(root.winfo_id())
        top = u.GetAncestor(child, GA_ROOT)
        if top and u.IsWindow(ctypes.c_void_p(top)):
            return int(top)
    except Exception:
        pass
    return 0


def enable_drop(root):
    """在 Tk 根窗口上挂拖放。环境变量 STICKER_NO_DROP=1 可强制关闭（排障用）。
    任何一步拿不到有效句柄就直接放弃，绝不挂残缺钩子。
    调用方用 after 轮询 target.pending，把路径捞出来再进 Tk。"""
    import sys as _sys
    if _sys.platform != 'win32':
        return None
    if os.environ.get('STICKER_NO_DROP') == '1':
        print('drop disabled by STICKER_NO_DROP', flush=True)
        return None
    try:
        root.update_idletasks()
        hwnd = _toplevel_hwnd(root)
        if not hwnd:
            print('drop skipped: no toplevel hwnd', flush=True)
            return None
        target = FolderDropTarget(hwnd)
        target._install()
        print(f'drop installed on hwnd=0x{hwnd:X}', flush=True)
        return target
    except Exception as ex:
        print(f'drop skipped: {ex}', flush=True)
        return None


def expand_paths(paths, exts=('.webm',)):
    """把拖进来的路径展开成文件列表：文件夹递归，视频文件直取。"""
    out: list[Path] = []
    seen: set[str] = set()
    for p in paths:
        try:
            path = Path(p)
        except Exception:
            continue
        cands: list[Path] = []
        try:
            if path.is_dir():
                for e in exts:
                    cands.extend(sorted(path.rglob('*' + e)))
            elif path.is_file() and path.suffix.lower() in exts:
                cands = [path]
        except Exception:
            continue
        for r in cands:
            try:
                key = str(r.resolve())
            except Exception:
                key = str(r)
            if key not in seen:
                seen.add(key)
                out.append(r)
    uniq: list[Path] = []
    for r in out:
        if r not in uniq:
            uniq.append(r)
    return uniq


def _cleanup_stale_tmps(max_age_s: float = 24 * 3600) -> int:
    """清掉 TEMP 下超过 max_age 的 sticker_* 残留目录（上次崩溃/未正常退出留下的）。
    只删自己的前缀，不过期不动，避免误伤其它正在运行的实例。"""
    tmp = Path(tempfile.gettempdir())
    now = time.time()
    n = 0
    try:
        for d in tmp.glob('sticker_*'):
            try:
                if not d.is_dir():
                    continue
                if now - d.stat().st_mtime < max_age_s:
                    continue
                shutil.rmtree(d, ignore_errors=True)
                n += 1
            except Exception:
                continue
    except Exception:
        pass
    return n


# ---------------------------------------------------------------- 元数据

@dataclass
class VideoSpec:
    codec: str
    pix_fmt: str
    width: int
    height: int
    fps_num: int
    fps_den: int
    duration: float
    color_range: str | None
    n_frames: int = 0

    @property
    def fps(self) -> float:
        if self.fps_den:
            return self.fps_num / self.fps_den
        return 24.0

    @property
    def fps_frac(self) -> str:
        return f'{self.fps_num}/{self.fps_den}'

    @property
    def has_alpha(self) -> bool:
        # VP9 透明 webm 的 alpha 以「分离 alpha 流」形式存储：主流 ffprobe 只报
        # yuv420p，看不到 alpha。probe_spec 会显式解码首帧探测，把结果写回此字段。
        return getattr(self, '_alpha', False) or 'a' in self.pix_fmt

    @property
    def enc_pix_fmt(self) -> str:
        """编码用的像素格式：源有 alpha 就必须 yuva420p，否则 alpha 会被丢弃。"""
        return 'yuva420p' if self.has_alpha else self.pix_fmt


def _detect_alpha(webm: Path) -> bool:
    """真实解码首帧判断是否带 alpha。

    关键：透明 VP9 webm 的 alpha 存在独立流里，ffprobe 的 pix_fmt 永远是
    yuv420p（看不见 alpha）。唯一可靠的判据是**用 libvpx-vp9 解码器解一帧**，
    若输出 RGBA 且存在半透明/透明像素，则源带 alpha。原生解码器会直接丢 alpha。
    """
    try:
        with tempfile.TemporaryDirectory() as td:
            png = Path(td) / 'a.png'
            _run(
                [_tool('ffmpeg'), '-y', '-v', 'error', '-c:v', 'libvpx-vp9',
                 '-i', str(webm), '-frames:v', '1', str(png)],
                check=True, capture_output=True)
            im = Image.open(png)
            if im.mode != 'RGBA':
                return False
            a = im.getchannel('A')
            # 有任何像素 alpha < 250 即认为带透明
            lo, hi = a.getextrema()
            return lo < 250
    except Exception:
        return False


def probe_spec(webm: Path) -> VideoSpec:
    out = _run(
        [_tool('ffprobe'), '-v', 'error', '-select_streams', 'v',
         '-show_entries', 'stream=codec_name,pix_fmt,width,height,r_frame_rate,avg_frame_rate,color_range',
         '-show_entries', 'format=duration', '-of', 'json', str(webm)],
        check=True, capture_output=True, text=True)
    d = json.loads(out.stdout)
    s = d['streams'][0]
    dur = float(d.get('format', {}).get('duration', 0.0) or 0.0)

    def _parse_fps(cand):
        if isinstance(cand, str) and '/' in cand:
            try:
                num, den = (int(x) for x in cand.split('/'))
            except Exception:
                return None
            if den <= 0 or num <= 0:
                return None
            return num, den
        try:
            num = int(round(float(cand)))
        except Exception:
            return None
        if num <= 0:
            return None
        return num, 1

    num, den = _parse_fps(s.get('avg_frame_rate')) or (24, 1)
    spec = VideoSpec(
        codec=s.get('codec_name', 'vp9'), pix_fmt=s.get('pix_fmt', 'yuv420p'),
        width=int(s.get('width', 0)), height=int(s.get('height', 0)),
        fps_num=num, fps_den=den, duration=dur, color_range=s.get('color_range'))
    spec._alpha = _detect_alpha(webm)
    return spec


def count_frames(webm: Path) -> int:
    """数真实帧数，优先 -count_packets：只读容器包头，不解码像素，很快。

    -count_frames 会真正解码每一帧，对 1080p 透明素材等于白白多解码一遍，
    代价太大，所以先用 count_packets（webm 里每个 video packet 就是一帧）。
    拿不到再退回 nb_frames（容器头里的声明值，通常来自 mux 时写入，可信度高）。
    """
    for entries, flag in (('stream=nb_read_packets', '-count_packets'),
                          ('stream=nb_frames', None)):
        try:
            cmd = [_tool('ffprobe'), '-v', 'error', '-select_streams', 'v:0']
            if flag:
                cmd.append(flag)
            cmd += ['-show_entries', entries, '-of', 'json', str(webm)]
            out = _run(cmd, check=True, capture_output=True, text=True, timeout=60)
            d = json.loads(out.stdout)
            raw = (d.get('streams') or [{}])[0].get(entries.split('=')[1])
            if raw in (None, '', 'N/A'):
                continue
            n = int(str(raw).split('=')[-1].strip() or 0)
            if n > 0:
                return n
        except Exception:
            continue
    return 0


def _approx_fraction(fps: float, max_den: int = 120):
    for den in range(1, max_den + 1):
        num = round(fps * den)
        if abs(num / den - fps) < 0.0001:
            return num, den
    return round(fps), 1


def resolve_fps(webm: Path, spec: VideoSpec):
    """用“真实帧数 ÷ 源时长”算帧率；probe 的结果只作为复核/审计。

    r_frame_rate 在坏时间戳文件上经常是 1000/1 这种野值，超过上限直接 제재。
    """
    n = count_frames(webm)
    dur = spec.duration
    if n > 0 and dur > 0:
        fps = n / dur
        if 1.0 <= fps <= MAX_TRUSTED_FPS:
            frac = _approx_fraction(fps)
            print(f'fps from frames: n={n} dur={dur:.3f}s -> {frac[0]}/{frac[1]} ({fps:.3f})', flush=True)
            return frac
    fps = spec.fps
    if 1.0 <= fps <= MAX_TRUSTED_FPS:
        frac = _approx_fraction(fps)
        print(f'fps from probe (no frame count): -> {frac[0]}/{frac[1]}', flush=True)
        return frac
    print(f'fps untrusted ({spec.fps_num}/{spec.fps_den}), fallback 24/1', flush=True)
    return (24, 1)


# ---------------------------------------------------------------- 帧仓库

class FrameStore:
    """把源 webm 解成 PNG 帧放临时目录，按需加载 + LRU 缓存。"""

    def __init__(self, webm: Path, spec: VideoSpec, tmp_root: Path,
                 slot: str = 'default') -> None:
        self.webm = webm
        self.spec = spec
        # FIX(多webm 数据丢失): 每个 webm 必须有独立帧目录。原实现所有视频共用
        # `<tmp>/frames`，extract() 开头的 rmtree 会把上一个视频解出的帧全删掉——
        # 切回上一个视频时关键帧还在，底图却已经没了。
        # slot 是任意标识（通常传路径字符串），必须哈希成合法目录名：
        # Windows 目录名不允许冒号/反斜杠，直接拼接会 WinError 123。
        digest = hashlib.md5(str(slot).encode('utf-8', 'replace')).hexdigest()[:16]
        self.dir = Path(tmp_root) / f'frames_{digest}'
        self.paths: list[Path] = []
        self._cache: dict[int, Image.Image] = {}
        self._order: list[int] = []

    def extract(self) -> int:
        if self.dir.exists():
            shutil.rmtree(self.dir, ignore_errors=True)
        self.dir.mkdir(parents=True, exist_ok=True)
        # FIX(帧爆炸): 源时间戳损坏时 r_frame_rate 可达 1000/1，不加钳制
        # ffmpeg 会复制出 40 多倍的重复帧（3 秒视频 → 3155 张 PNG → 2.6GB）。
        # -fps_mode passthrough 只取容器真实包，dup 不再产生。
        # FIX(alpha 丢失): 源若带分离 alpha 流，-i 前必须指定 libvpx-vp9 解码器，
        # 否则 ffmpeg 用原生解码器会把 alpha 丢掉，生成的 PNG 变不透明黑底。
        dec_cmd = [_tool('ffmpeg'), '-y']
        if self.spec.has_alpha:
            dec_cmd += ['-c:v', 'libvpx-vp9']
        dec_cmd += ['-i', str(self.webm),
                    '-fps_mode', 'passthrough', str(self.dir / 'f_%05d.png')]
        _run(dec_cmd, check=True, capture_output=True)
        self.paths = sorted(self.dir.glob('f_*.png'))
        self.spec.n_frames = len(self.paths)
        if self.spec.duration <= 0 and self.paths and self.spec.fps > 0:
            self.spec.duration = len(self.paths) / self.spec.fps
        # 二次保险：即使 passthrough 失效，也按包数截断并告警，不再写爆磁盘。
        try:
            src_n = count_frames(self.webm)
        except Exception:
            src_n = 0
        if src_n > 0 and len(self.paths) > int(src_n * DECODE_OVERRUN_RATIO) + DECODE_OVERRUN_SLACK:
            keep = int(src_n * DECODE_OVERRUN_RATIO) + DECODE_OVERRUN_SLACK
            print(f'WARN decoder overrun: got {len(self.paths)} > limit {keep} '
                  f'(src_frames={src_n}), truncating', flush=True)
            for p in self.paths[keep:]:
                try:
                    p.unlink()
                except Exception:
                    pass
            self.paths = self.paths[:keep]
            self.spec.n_frames = len(self.paths)
        # FIX(磁盘预检): 先算后写。以前是写到一半 ENOSPC，报的还是裸 CalledProcessError。
        try:
            need = self.spec.width * self.spec.height * 4 * max(len(self.paths), 1)
            free = shutil.disk_usage(self.dir).free
            if free < need + 50 * 1024 * 1024:
                print(f'WARN low disk: need~{need/1e9:.1f}GB free~{free/1e9:.1f}GB', flush=True)
        except Exception:
            pass
        return len(self.paths)

    def frame(self, i: int) -> Image.Image:
        i = max(0, min(i, len(self.paths) - 1))
        if i in self._cache:
            self._order.remove(i)
            self._order.append(i)
            return self._cache[i]
        # 保留源 alpha：透明 webm 的 PNG 帧是 RGBA，转 RGB 会把背景变成黑块。
        im = Image.open(self.paths[i])
        im = im.convert('RGBA') if im.mode in ('RGBA', 'LA', 'P') else im.convert('RGB')
        self._cache[i] = im
        self._order.append(i)
        while len(self._order) > 48:
            old = self._order.pop(0)
            self._cache.pop(old, None)
        return im

    def load_rgba(self, i: int) -> Image.Image:
        i = max(0, min(i, len(self.paths) - 1))
        return Image.open(self.paths[i]).convert('RGBA')


# ---------------------------------------------------------------- 贴纸

@dataclass
class Keyframe:
    frame: int
    cx: float
    cy: float
    scale: float
    rot: float
    alpha: float = 1.0


@dataclass
class Session:
    """一个 webm 的独立编辑会话。

    FIX(动画数据丢失): 原实现只有一份全局 `state['stickers']`，切换 webm 时被
    `state['stickers'] = []` 清空，于是给 A 视频调好的关键帧在切到 B 视频后消失。
    现在每个 webm 各自持有 stickers / active / frame，切换即存取，互不干扰。
    """
    webm: Path
    spec: VideoSpec
    store: FrameStore
    stickers: list['Sticker'] = field(default_factory=list)
    active: int = -1
    frame: int = 1


@dataclass
class Sticker:
    name: str
    png_path: str
    visible: bool = True
    keyframes: list[Keyframe] = field(default_factory=list)
    _img: Image.Image | None = None
    _cache_key: tuple | None = None
    _cache_img: Image.Image | None = None

    def image(self) -> Image.Image:
        if self._img is None:
            self._img = Image.open(self.png_path).convert('RGBA')
        return self._img

    def transform_at(self, frame: int) -> Keyframe:
        kfs = sorted(self.keyframes, key=lambda k: k.frame)
        if not kfs:
            img = self.image()
            return Keyframe(frame, img.width / 2, img.height / 2, 1.0, 0.0, 1.0)
        if frame <= kfs[0].frame:
            return kfs[0]
        if frame >= kfs[-1].frame:
            return kfs[-1]
        for a, b in zip(kfs, kfs[1:]):
            if a.frame <= frame:
                if frame <= b.frame:
                    break
            continue
            break
        else:
            return kfs[-1]
        t = (frame - a.frame) / max(1, b.frame - a.frame)
        return Keyframe(
            frame,
            a.cx + (b.cx - a.cx) * t,
            a.cy + (b.cy - a.cy) * t,
            a.scale + (b.scale - a.scale) * t,
            a.rot + (b.rot - a.rot) * t,
            a.alpha + (b.alpha - a.alpha) * t,
        )

    def prepared(self, kf: Keyframe) -> Image.Image:
        """取（并缓存）按 kf 变换好的贴纸图。

        关键帧之间是线性插值，所以并非每帧的变换都不同——用 kf 参数做键，
        绝大多数帧能直接命中缓存，跳过 LANCZOS 缩放和 BICUBIC 旋转。
        """
        key = (kf.cx, kf.cy, kf.scale, kf.rot, kf.alpha)
        if self._cache_key == key and self._cache_img is not None:
            return self._cache_img
        img = self.image()
        w = max(1, int(img.width * kf.scale))
        h = max(1, int(img.height * kf.scale))
        timg = img.resize((w, h), Image.LANCZOS)
        if abs(kf.rot) > 0.01:
            timg = timg.rotate(kf.rot, expand=True, resample=Image.BICUBIC)
        if kf.alpha < 0.999:
            a = timg.getchannel('A').point(lambda v: int(v * kf.alpha))
            timg.putalpha(a)
        self._cache_key = key
        self._cache_img = timg
        return timg


def render_sticker(base: Image.Image, sticker: Sticker, kf: Keyframe) -> Image.Image:
    timg = sticker.prepared(kf)
    px = int(round(kf.cx - timg.width / 2))
    py = int(round(kf.cy - timg.height / 2))
    out = base.convert('RGBA')
    out.alpha_composite(timg, (px, py))
    return out


def composite_inplace(base: Image.Image, layer: Image.Image, px: int, py: int) -> None:
    """只在 layer 覆盖到的区域做合成，不整帧复制。

    base 会被就地修改（调用方持有唯一引用）。1080p 透明素材整帧 alpha_composite
    一次要搬 8MB，改成局部粘贴后开销与贴纸大小成正比。
    """
    w, h = layer.size
    x0, y0 = max(0, px), max(0, py)
    x1, y1 = min(base.width, px + w), min(base.height, py + h)
    if x1 <= x0 or y1 <= y0:
        return
    crop = layer.crop((x0 - px, y0 - py, x1 - px, y1 - py))
    base.paste(crop, (x0, y0), crop)


def render_frame_rgba(base: Image.Image, stickers: list[Sticker], frame: int) -> Image.Image:
    """RGBA 版本合成：保留源的透明通道（透明 webm 必须走这条）。就地修改 base。"""
    out = base.convert('RGBA')
    for st in stickers:
        if not st.visible or not st.keyframes:
            continue
        kf = st.transform_at(frame)
        layer = st.prepared(kf)
        px = int(round(kf.cx - layer.width / 2))
        py = int(round(kf.cy - layer.height / 2))
        composite_inplace(out, layer, px, py)
    return out


def render_frame(base: Image.Image, stickers: list[Sticker], frame: int) -> Image.Image:
    """预览用：合成后若带 alpha，铺到棋盘格背景上显示透明区域。

    直接 convert('RGB') 会把透明区变成黑色，用户无法判断 alpha 是否正确；
    棋盘格是图像编辑器的通行做法，能直观看出哪里透明。
    """
    out = render_frame_rgba(base, stickers, frame)
    if out.mode == 'RGBA' and out.getchannel('A').getextrema()[0] < 250:
        return _checkerboard_under(out)
    return out.convert('RGB')


def _checkerboard_under(im: Image.Image, cell: int = 16) -> Image.Image:
    """把 RGBA 图叠到灰白棋盘格上，产出 RGB。透明区显示为棋盘格。"""
    w, h = im.size
    board = Image.new('RGB', (w, h), (255, 255, 255))
    px = board.load()
    dark = (200, 200, 200)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if ((x // cell) + (y // cell)) % 2:
                for yy in range(y, min(y + cell, h)):
                    for xx in range(x, min(x + cell, w)):
                        px[xx, yy] = dark
    out = board.convert('RGBA')
    out.alpha_composite(im)
    return out.convert('RGB')


# ---------------------------------------------------------------- 画质

@dataclass
class Quality:
    """画质预设。preset 越快导得越快，画质越差。"""
    name: str
    crf: int
    cpu_used: int
    deadline: str
    lossless: bool = False
    extra: list[str] = field(default_factory=list)


QUALITY_PRESETS: dict[str, Quality] = {
    'fast': Quality('极速(预览档)', 32, 5, 'realtime'),
    'balanced': Quality('标准', 20, 2, 'good'),
    'lossless': Quality('无损', 0, 1, 'best', lossless=True),
}


def quality_label_map() -> dict[str, str]:
    """key -> 中文标签，给下拉框显示用。"""
    return {k: q.name for k, q in QUALITY_PRESETS.items()}


def _quality_argv(q: Quality) -> list[str]:
    if q.lossless:
        return ['-lossless', '1', '-crf', '0', '-b:v', '0']
    argv = ['-crf', str(q.crf), '-b:v', '0', '-cpu-used', str(q.cpu_used),
            '-deadline', q.deadline, '-row-mt', '1']
    argv += list(q.extra or [])
    return argv


def encode_frames(frame_dir: Path, out_webm: Path, spec: VideoSpec,
                  lossless: bool, crf: int) -> None:
    """按源规格重编码：codec/pix_fmt/分辨率/帧率/色彩范围全部沿用。"""
    quality = replace(QUALITY_PRESETS['lossless' if lossless else 'balanced'], crf=crf)
    cmd = [_tool('ffmpeg'), '-y', '-framerate', spec.fps_frac, '-i', str(frame_dir / 'f_%05d.png'),
           '-c:v', 'libvpx-vp9' if spec.codec == 'vp9' else spec.codec,
           '-pix_fmt', spec.enc_pix_fmt, '-auto-alt-ref', '0']
    if spec.color_range:
        cmd += ['-color_range', spec.color_range]
    cmd += _quality_argv(quality)
    cmd += ['-an', str(out_webm.with_suffix('.tmp.webm'))]
    _run(cmd, check=True, capture_output=True)
    out_webm.with_suffix('.tmp.webm').replace(out_webm)


def stream_export(webm: Path, stickers: list[Sticker], out_webm: Path,
                  quality: Quality, progress=None, cancel=None) -> int:
    """零落盘导出：解码器 --rawvideo 管道 → 内存合成 → 编码器管道。

    相比“解 PNG / 改 PNG / 编 PNG”，省掉两次全量磁盘 IO 与 PNG 编解码，
    同时用 cpu-used/deadline 把 VP9 从“无损天价”拉回实时档。
    """
    spec = probe_spec(webm)
    fps_num, fps_den = resolve_fps(webm, spec)
    spec.fps_num, spec.fps_den = fps_num, fps_den
    out_webm.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_webm.with_suffix('.tmp.webm')

    # FIX(alpha 丢失): 源若带分离 alpha 流，必须用 libvpx-vp9 解码器才能解出 alpha，
    # 且编码必须显式 yuva420p；否则 alpha 在解码/编码任一环节被静默丢弃，
    # 结果是「黑底不透明」——这正是之前软件输出错误的根因。
    dec = [_tool('ffmpeg'), '-v', 'error']
    if spec.has_alpha:
        dec += ['-c:v', 'libvpx-vp9']
    dec += ['-i', str(webm),
            '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']
    enc = [_tool('ffmpeg'), '-y', '-v', 'error',
           '-f', 'rawvideo', '-pix_fmt', 'rgba',
           '-s', f'{spec.width}x{spec.height}', '-r', spec.fps_frac, '-i', '-',
           '-c:v', 'libvpx-vp9' if spec.codec == 'vp9' else spec.codec,
           '-pix_fmt', spec.enc_pix_fmt, '-auto-alt-ref', '0']
    if spec.color_range:
        enc += ['-color_range', spec.color_range]
    enc += _quality_argv(quality)
    enc += ['-an', str(tmp)]

    frame_bytes = spec.width * spec.height * 4
    # 解码器的 stderr 必须捕获：找不到 ffmpeg / 参数非法时它会立刻退出，
    # 若丢进 DEVNULL 就只剩「20s 没有输出第一帧」这种误导性提示。
    # FIX(windowed EXE 导出卡死): PyInstaller noconsole 程序没有控制台，子进程若试图
    # 继承一个不存在的控制台，Popen 的管道会永远阻塞——表现为「解码器 20s 没有输出
    # 第一帧」，而 run() 却正常。必须显式 CREATE_NO_WINDOW 切断控制台继承。
    no_win = getattr(subprocess, 'CREATE_NO_WINDOW', 0) if os.name == 'nt' else 0
    dec_p = _popen(dec, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                   bufsize=frame_bytes)
    enc_p = _popen(enc, stdin=subprocess.PIPE,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    def _drain(p, limit=3.0):
        """限时读取 stderr：解码器若卡住不退出，read() 会永久阻塞。"""
        try:
            r: list = []

            def _r():
                try:
                    r.append(p.stderr.read())
                except Exception:
                    pass
            th = threading.Thread(target=_r, daemon=True)
            th.start()
            th.join(timeout=limit)
            return (r[0] if r else b'').decode('utf-8', 'replace')
        except Exception:
            return ''

    first: list[bytes] = []
    err: list = []

    def _read_first() -> None:
        try:
            chunk = dec_p.stdout.read(frame_bytes)
            if chunk:
                first.append(chunk)
        except Exception as ex:
            err.append(ex)

    t0 = threading.Thread(target=_read_first, daemon=True)
    t0.start()
    t0.join(timeout=20.0)
    if not first:
        dec_rc = dec_p.poll()
        enc_rc = enc_p.poll()
        dec_err = _drain(dec_p)[-600:]
        for p in (enc_p, dec_p):
            try:
                p.kill()
            except Exception:
                pass
        raise RuntimeError(
            f'解码器 20s 内没有输出第一帧（dec rc={dec_rc}，enc rc={enc_rc}）'
            + (f'\n解码器报错：{dec_err}' if dec_err.strip() else
               '\n解码器无任何输出：很可能是找不到 ffmpeg（PATH 缺失），'
               '或解码器启动即崩溃。')
            + '\n源文件可能损坏，或 ffmpeg 解码该 webm 失败。')

    src_frames = count_frames(webm)
    limit = int(src_frames * DECODE_OVERRUN_RATIO) + DECODE_OVERRUN_SLACK if src_frames > 0 else 0

    assert dec_p.stdout is not None and enc_p.stdin is not None
    n = 0
    pending: list[bytes] = [first[0]]
    broken = False
    try:
        while True:
            if cancel is not None and cancel.is_set():
                raise InterruptedError('导出已取消')
            if enc_p.poll() is not None:
                raise RuntimeError('编码进程已退出，导出中止')
            if limit and n >= limit:
                print(f'WARN decoder overrun: got {n} > limit {limit} '
                      f'(src_frames={src_frames}), truncating', flush=True)
                break
            if pending:
                buf = pending.pop()
            else:
                buf = dec_p.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            im = Image.frombuffer('RGBA', (spec.width, spec.height), buf, 'raw', 'RGBA', 0, 1)
            merged = render_frame_rgba(im.copy(), stickers, n + 1)
            try:
                enc_p.stdin.write(merged.tobytes())
            except (BrokenPipeError, OSError):
                broken = True
                break
            n += 1
            if progress is not None:
                try:
                    progress(n, src_frames or None)
                except Exception:
                    pass
    finally:
        try:
            enc_p.stdin.close()
        except Exception:
            pass
    enc_err = ''
    try:
        enc_err = (enc_p.stderr.read() or b'').decode('utf-8', 'replace')
    except Exception:
        pass
    rc = enc_p.wait()
    dec_p.wait()
    print(f'decoded {n} frames (src_frames={src_frames}, fps={fps_num}/{fps_den})', flush=True)
    if broken or rc != 0:
        tail = '\n'.join(enc_err.strip().splitlines()[-8:])
        raise RuntimeError(f'ffmpeg 退出码 {rc}\n{tail}')
    out_spec = probe_spec(tmp)
    if spec.duration > 0 and out_spec.duration > 0:
        ratio = out_spec.duration / spec.duration
        if ratio > 1.25 or ratio < 0.75:
            print(f'WARN duration drift: src={spec.duration:.2f}s out={out_spec.duration:.2f}s '
                  f'ratio={ratio:.2f}', flush=True)
    tmp.replace(out_webm)
    return n


def export_project(webm: Path, stickers: list[Sticker], out_webm: Path,
                   lossless: bool, crf: int, tmp_root: Path) -> int:
    spec = probe_spec(webm)
    store = FrameStore(webm, spec, tmp_root)
    n = store.extract()
    for i in range(len(store.paths)):
        base = Image.open(store.paths[i]).convert('RGB')
        out = render_frame(base, stickers, i + 1)
        out.save(store.dir / f'o_{i + 1:05d}.png')
    # 用 o_*.png 重命名为 f_*.png 再编码（extract 的 f_*.png 是源帧，保留不动）
    for i, p in enumerate(sorted(store.dir.glob('o_*.png'))):
        p.replace(store.dir / f'f_{i + 1:05d}.png')
    for p in sorted(store.dir.glob('f_*.png')):
        if int(p.stem.split('_')[1]) > n:
            break
    encode_frames(store.dir, out_webm, spec, lossless, crf)
    q = Quality('标准', crf, 4, 'good')
    _ = q
    return n


    n = len(store.paths)
    # 落盘导出：把合成帧写回 f_*.png 再按源规格编码
    for i, p in enumerate(sorted(store.dir.glob('o_*.png'))):
        p.replace(store.dir / f'f_{i + 1:05d}.png')
    encode_frames(store.dir, out_webm, spec, lossless, crf)
    return n


# ---------------------------------------------------------------- GUI

def run_gui(args) -> None:
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox, simpledialog

    # 启动时顺手清掉上次崩溃留下的 sticker_* 残留（只清 24h 以上的）
    try:
        _cleanup_stale_tmps()
    except Exception:
        pass

    root = tk.Tk()
    root.title('webm 贴图编辑器')
    root.geometry('1100x900')

    # sessions: key=resolve 后的路径字符串 -> Session（每个 webm 一份独立编辑数据）
    # library:  PNG 素材库，常驻左下，跨 webm 复用，不随切换清空
    state = {'webm': None, 'spec': None, 'store': None, 'stickers': [],
             'active': -1, 'frame': 1, 'tmp': Path(tempfile.mkdtemp(prefix='sticker_')),
             'canvas_scale': 1.0, 'playing': False, 'drag_mode': None,
             'drag_ref': None, 'queue': [], 'busy': False,
             'loading': False, 'sessions': {}, 'library': [], 'lib_active': -1,
             'batch_mode': False, 'anim_clip': None}
    atexit.register(lambda: shutil.rmtree(state['tmp'], ignore_errors=True))

    top = ttk.Frame(root)
    top.pack(fill='x', padx=6, pady=4)
    info = tk.StringVar(value='拖入 .webm 文件或整个文件夹即可开始')
    ttk.Label(top, textvariable=info).pack(side='left')

    canvas = tk.Canvas(root, bg='#202020', highlightthickness=0)
    canvas.pack(fill='both', expand=True, padx=6, pady=4)

    left = ttk.Frame(root)
    left.pack(fill='x', padx=6)
    sticker_list = tk.Listbox(left, height=5)
    sticker_list.pack(side='left', fill='x', expand=True)
    queue_list = tk.Listbox(left, height=5, width=44)
    queue_list.pack(side='left', fill='y')
    queue_list.bind('<Double-Button-1>', lambda e: load_queued())

    # PNG 素材库：常驻左下，切换 webm 不清空（用户要求：PNG 一直保留）
    lib_frame = ttk.LabelFrame(root, text='PNG 素材库（跨视频复用，切换不丢）')
    lib_frame.pack(fill='x', padx=6, pady=(2, 0))
    lib_list = tk.Listbox(lib_frame, height=4)
    lib_list.pack(side='left', fill='x', expand=True)
    # 注意：不要在这里 bind，select_lib 定义在下方（布局先于逻辑，绑定需后置）
    lib_btns = ttk.Frame(lib_frame)
    lib_btns.pack(side='left', fill='y', padx=4)

    ctrl = ttk.Frame(root)
    ctrl.pack(fill='x', padx=6, pady=4)
    frame_var = tk.IntVar(value=1)
    slider = ttk.Scale(root, from_=1, to=1, orient='horizontal',
                       command=lambda v: on_slider(v))
    slider.pack(fill='x', padx=6)

    photo: dict = {'img': None}
    # 滑杆回调重入锁：set_frame→slider.set 会回触发 on_slider，不锁就无限递归
    suppress: dict = {'slider': False}
    img_on_canvas: dict = {'id': None, 'sticker_id': None, 'box': None}
    playback: dict = {'after': None}
    quality_var = tk.StringVar(value='fast' if not args.lossless else 'lossless')
    progress = tk.StringVar(value='空闲')

    def photo_for():
        store = state['store']
        if not store:
            return None
        im = render_frame(store.frame(state['frame'] - 1), state['stickers'], state['frame'])
        return im

    def redraw():
        store = state['store']
        canvas.delete('all')
        if not store or not store.paths:
            return
        cw = max(canvas.winfo_width(), 10)
        ch = max(canvas.winfo_height(), 10)
        sw, sh = store.spec.width, store.spec.height
        sc = min(cw / sw, ch / sh)
        sc = min(sc, 1.0) if sc > 0 else 1.0
        state['canvas_scale'] = sc
        im = photo_for()
        if im is None:
            return
        disp = im.resize((max(1, int(sw * sc)), max(1, int(sh * sc))), Image.LANCZOS)
        photo['img'] = ImageTk.PhotoImage(disp)
        img_on_canvas['id'] = canvas.create_image(0, 0, anchor='nw', image=photo['img'])
        draw_active_handle()
        st = state['webm'].name if state['webm'] else ''
        spec = state['spec']
        fps = spec.fps_frac if spec else '?'
        extra = f'  [{len(store.paths)} 帧 @{fps} {spec.width}x{spec.height}]' if spec else ''
        info.set(f'{st}  {state["frame"]}/{len(store.paths)} 帧  {len(state["stickers"])} 贴纸' + extra)

    def draw_active_handle():
        canvas.delete('handle')
        st = None
        if 0 <= state['active'] < len(state['stickers']):
            st = state['stickers'][state['active']]
        if not st or not st.keyframes:
            return
        kf = st.transform_at(state['frame'])
        sc = state['canvas_scale']
        img = st.image()
        w = img.width * kf.scale * sc
        h = img.height * kf.scale * sc
        cx, cy = kf.cx * sc, kf.cy * sc
        canvas.create_rectangle(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2,
                                outline='#00e0ff', width=2, tags='handle')
        canvas.create_oval(cx + w / 2 - 6, cy + h / 2 - 6, cx + w / 2 + 6, cy + h / 2 + 6,
                           fill='#00e0ff', tags='handle')

    def on_slider(v):
        if suppress.get('slider'):
            return
        try:
            f = int(float(v))
        except Exception:
            return
        set_frame(f)

    def set_frame(f):
        store = state['store']
        if not store:
            return
        n = len(store.paths)
        f = max(1, min(f, n))
        state['frame'] = f
        frame_var.set(f)
        # FIX(递归爆栈): slider.set() 会再次触发 on_slider 回调，
        # 不加锁就是 set_frame↔on_slider 无限互递归 → RecursionError → 闪退。
        suppress['slider'] = True
        try:
            slider.set(f)
        except Exception:
            pass
        finally:
            suppress['slider'] = False
        redraw()

    def to_src(px, py):
        sc = state['canvas_scale'] or 1.0
        return px / sc, py / sc

    def on_press(ev):
        if not state['store']:
            return
        if 0 <= state['active'] < len(state['stickers']):
            st = state['stickers'][state['active']]
            if st.keyframes:
                kf = st.transform_at(state['frame'])
                sc = state['canvas_scale']
                img = st.image()
                w = img.width * kf.scale * sc
                h = img.height * kf.scale * sc
                cx, cy = kf.cx * sc, kf.cy * sc
                corner_x, corner_y = cx + w / 2, cy + h / 2
                if abs(ev.x - corner_x) < 10 and abs(ev.y - corner_y) < 10:
                    state['drag_mode'] = 'scale'
                    state['drag_ref'] = (kf.cx, kf.cy, kf.scale, ev.x, ev.y)
                    return
                if cx - w / 2 <= ev.x <= cx + w / 2 and cy - h / 2 <= ev.y <= cy + h / 2:
                    state['drag_mode'] = 'move'
                    state['drag_ref'] = (kf.cx, kf.cy, ev.x, ev.y)
                    return
        state['drag_mode'] = None

    def upsert_keyframe(st, kf):
        for k in st.keyframes:
            if k.frame == kf.frame:
                k.cx, k.cy, k.scale, k.rot, k.alpha = kf.cx, kf.cy, kf.scale, kf.rot, kf.alpha
                return
        st.keyframes.append(kf)

    def on_drag(ev):
        if not state['drag_mode'] or not state['drag_ref']:
            return
        if not (0 <= state['active'] < len(state['stickers'])):
            return
        st = state['stickers'][state['active']]
        kf = st.transform_at(state['frame'])
        if state['drag_mode'] == 'move':
            cx0, cy0, x0, y0 = state['drag_ref']
            sc = state['canvas_scale']
            nkf = Keyframe(kf.frame, cx0 + (ev.x - x0) / sc, cy0 + (ev.y - y0) / sc,
                           kf.scale, kf.rot, kf.alpha)
            upsert_keyframe(st, replace(nkf, frame=state['frame']))
        else:
            cx0, cy0, sc0, x0, y0 = state['drag_ref']
            sc = state['canvas_scale']
            d = ((ev.x - x0) ** 2 + (ev.y - y0) ** 2) ** 0.5
            ns = max(0.02, sc0 + d / 200.0 if ev.y >= y0 else sc0 - d / 200.0)
            upsert_keyframe(st, Keyframe(state['frame'], cx0, cy0, ns, kf.rot, kf.alpha))
        nxt = st.transform_at(state['frame'])
        _ = nxt
        redraw()

    def on_release(ev):
        state['drag_mode'] = None
        state['drag_ref'] = None

    def on_wheel(ev):
        if not (0 <= state['active'] < len(state['stickers'])):
            return
        st = state['stickers'][state['active']]
        kf = st.transform_at(state['frame'])
        f = 1.05 if ev.delta > 0 else 0.95
        upsert_keyframe(st, Keyframe(state['frame'], kf.cx, kf.cy,
                                     max(0.02, kf.scale * f), kf.rot, kf.alpha))
        redraw()

    def rotate(delta):
        if not (0 <= state['active'] < len(state['stickers'])):
            return
        st = state['stickers'][state['active']]
        kf = st.transform_at(state['frame'])
        upsert_keyframe(st, Keyframe(state['frame'], kf.cx, kf.cy, kf.scale,
                                     kf.rot + delta, kf.alpha))
        redraw()

    canvas.bind('<ButtonPress-1>', on_press)
    canvas.bind('<B1-Motion>', on_drag)
    canvas.bind('<ButtonRelease-1>', on_release)
    canvas.bind('<MouseWheel>', on_wheel)
    root.bind('<Left>', lambda e: set_frame(state['frame'] - 1))
    root.bind('<Right>', lambda e: set_frame(state['frame'] + 1))
    root.bind('q', lambda e: rotate(-5))
    root.bind('e', lambda e: rotate(5))
    root.bind('<space>', lambda e: toggle_play())

    def refresh_queue():
        queue_list.delete(0, 'end')
        for p in state['queue']:
            mark = '▶ ' if (state['webm'] and p == state['webm']) else '  '
            queue_list.insert('end', f'{mark}{p.name}')

    def enqueue(paths, autoload=True):
        known = {p.resolve() for p in state['queue']}
        added = [p for p in paths if p.resolve() not in known]
        state['queue'].extend(added)
        refresh_queue()
        if not added:
            info.set('队列里已经有了')
            return
        if autoload and state['webm'] is None:
            load_webm(added[0])
            return
        info.set(f'已加入 {len(added)} 个（队列共 {len(state["queue"])}）')

    def load_queued():
        sel = queue_list.curselection()
        if sel:
            load_webm(state['queue'][sel[0]])
            refresh_queue()

    def load_webm(webm: Path):
        # FIX(卡死): 解码放到后台线程，主线程只跑 after 轮询。以前这里同步解 26s+
        # 直接导致窗口「未响应」，连导两个就是「卡死」。
        if state.get('loading'):
            info.set('正在解码，请稍候…')
            return

        key = str(webm.resolve())

        # 已解码过就直接切换，动画数据原样恢复（无需重新解码）
        if key in state['sessions']:
            activate_session(key)
            return

        def do_load():
            try:
                info.set(f'解码 {webm.name} …')
                spec = probe_spec(webm)
                store = FrameStore(webm, spec, state['tmp'], slot=key)
                n = store.extract()

                def apply():
                    sess = Session(webm=webm, spec=spec, store=store,
                                   stickers=[], active=-1, frame=1)
                    state['sessions'][key] = sess
                    state['loading'] = False
                    bind_session(sess)
                    slider.configure(to=max(1, n))
                    root.after(0, lambda: set_frame(1))
                    refresh_lib()
                    refresh_queue()
                root.after(0, apply)
            except Exception as ex:
                def fail():
                    state['loading'] = False
                    messagebox.showerror('打开失败', f'{webm.name}\n{ex}')
                    info.set('打开失败')
                root.after(0, fail)

        state['loading'] = True
        info.set(f'解码 {webm.name} …')
        threading.Thread(target=do_load, daemon=True).start()

    def bind_session(sess: Session):
        """把某个 Session 的数据绑定到当前 UI 状态（state 指向该会话）。"""
        state['webm'] = sess.webm
        state['spec'] = sess.spec
        state['store'] = sess.store
        state['stickers'] = sess.stickers
        state['active'] = sess.active
        state['frame'] = sess.frame
        state['canvas_scale'] = 1.0
        refresh_list()

    def activate_session(key: str):
        """切换到已存在的会话：动画数据全部回来，不重新解码。"""
        sess = state['sessions'][key]
        bind_session(sess)
        n = len(sess.store.paths)
        slider.configure(to=max(1, n))
        refresh_queue()
        root.after(0, lambda: set_frame(sess.frame))
        info.set(f'{sess.webm.name}  ({len(sess.stickers)} 贴纸 / {len(sess.store.paths)} 帧)')

    def remove_queued():
        """从队列删除选中 webm，并清掉它的会话数据。"""
        sel = queue_list.curselection()
        if not sel:
            return
        p = state['queue'][sel[0]]
        key = str(p.resolve())
        state['queue'].pop(sel[0])
        state['sessions'].pop(key, None)
        if state['webm'] and str(state['webm'].resolve()) == key:
            nxt = state['queue'][0] if state['queue'] else None
            if nxt is not None and str(nxt.resolve()) in state['sessions']:
                activate_session(str(nxt.resolve()))
            else:
                state['webm'] = None
                state['store'] = None
                state['spec'] = None
                state['stickers'] = []
                state['active'] = -1
                state['frame'] = 1
                canvas.delete('all')
        refresh_queue()
        refresh_list()
        redraw()
        info.set(f'已从队列移除 {p.name}（队列剩 {len(state["queue"])}）')

    def on_dropped_found(found: list[Path]):
        """拖放路径已在 Tk 主循环上下文里展开完毕，安全可进 UI。"""
        try:
            paths = expand_paths(found, ('.webm',))
            if paths:
                enqueue(paths)
        except Exception as ex:
            print(f'drop enqueue failed: {ex}', flush=True)
            info.set('拖放处理失败')

    def open_webm():
        p = filedialog.askopenfilename(filetypes=[('webm', '*.webm')])
        if p:
            enqueue([Path(p)])

    def open_folder():
        p = filedialog.askdirectory(title='选择包含 webm 的文件夹（可多级）')
        if not p:
            return
        found = expand_paths([p], ('.webm',))
        if not found:
            messagebox.showinfo('空文件夹', '该文件夹下没有 .webm')
            return
        enqueue(found)

    def add_lib_png():
        """PNG 加入素材库（常驻，不随视频切换消失），并加到当前会话。"""
        p = filedialog.askopenfilename(filetypes=[('image', '*.png *.webp')])
        if not p:
            return
        key = str(Path(p).resolve())
        if not any(str(Path(x['path']).resolve()) == key for x in state['library']):
            state['library'].append({'path': p, 'name': Path(p).stem})
        refresh_lib()
        apply_lib_to_current()

    def add_lib_multi():
        p = filedialog.askopenfilenames(filetypes=[('image', '*.png *.webp')])
        if not p:
            return
        for x in p:
            key = str(Path(x).resolve())
            if not any(str(Path(i['path']).resolve()) == key for i in state['library']):
                state['library'].append({'path': x, 'name': Path(x).stem})
        refresh_lib()
        info.set(f'素材库共 {len(state["library"])} 张 PNG')

    def refresh_lib():
        lib_list.delete(0, 'end')
        for i, it in enumerate(state['library']):
            mark = '*' if i == state['lib_active'] else ' '
            lib_list.insert('end', f'{mark}{it["name"]}')

    def select_lib(ev):
        sel = lib_list.curselection()
        state['lib_active'] = sel[0] if sel else -1
        refresh_lib()

    def apply_lib_to_current():
        """把库中选中的 PNG 加到当前 webm，生成独立的关键帧数据。"""
        if state['lib_active'] < 0 or not state['store']:
            info.set('先在下面选中一张 PNG，并打开一个 webm')
            return
        item = state['library'][state['lib_active']]
        add_sticker_for(item['path'])

    def add_sticker_for(png_path):
        if not state['store']:
            return
        img = Image.open(png_path)
        sw, sh = state['spec'].width, state['spec'].height
        kf = Keyframe(state['frame'], sw / 2, sh / 2, 1.0, 0.0, 1.0)
        st = Sticker(name=Path(png_path).stem, png_path=str(png_path),
                     keyframes=[kf])
        # 注意：新加 PNG 一律从单帧起步，绝不自动套用剪贴板动画。
        # 只能由用户显式点「粘贴动画」才会复制轨迹，避免误继承上一次的动画。
        state['stickers'].append(st)
        state['active'] = len(state['stickers']) - 1
        refresh_list()
        redraw()

    def remove_lib_png():
        """从素材库移除选中 PNG（不动已生成的贴纸实例）。"""
        if state['lib_active'] < 0:
            return
        name = state['library'][state['lib_active']]['name']
        state['library'].pop(state['lib_active'])
        state['lib_active'] = min(state['lib_active'], len(state['library']) - 1)
        refresh_lib()
        info.set(f'已从素材库移除 {name}（库剩 {len(state["library"])} 张）')

    def refresh_list():
        sticker_list.delete(0, 'end')
        for i, st in enumerate(state['stickers']):
            vis = '' if st.visible else '(隐)'
            mark = '*' if i == state['active'] else ' '
            sticker_list.insert('end', f'{mark}{st.name}{vis} kf={len(st.keyframes)}')

    def select_sticker(ev):
        sel = sticker_list.curselection()
        if sel:
            state['active'] = sel[0]
            refresh_list()
            redraw()

    def set_keyframe_here():
        if not (0 <= state['active'] < len(state['stickers'])):
            return
        st = state['stickers'][state['active']]
        kf = st.transform_at(state['frame'])
        upsert_keyframe(st, replace(kf, frame=state['frame']))
        refresh_list()
        redraw()

    def del_keyframe():
        if not (0 <= state['active'] < len(state['stickers'])):
            return
        st = state['stickers'][state['active']]
        st.keyframes = [k for k in st.keyframes if k.frame != state['frame']]
        refresh_list()
        redraw()

    def clear_all_keyframes():
        """删除选中贴纸的全部关键帧（动画轨迹清空，贴纸本身保留）。"""
        if not (0 <= state['active'] < len(state['stickers'])):
            info.set('先选中一个贴纸')
            return
        st = state['stickers'][state['active']]
        if not st.keyframes:
            info.set(f'{st.name} 本来就没有关键帧')
            return
        n = len(st.keyframes)
        if not messagebox.askyesno('删除所有帧',
                                   f'清空 {st.name} 的全部 {n} 个关键帧？\n'
                                   '贴纸本身会保留，但动画轨迹会被删除。'):
            return
        st.keyframes = []
        refresh_list()
        redraw()
        info.set(f'已清空 {st.name} 的 {n} 个关键帧')

    def toggle_visible():
        if not (0 <= state['active'] < len(state['stickers'])):
            return
        st = state['stickers'][state['active']]
        st.visible = not st.visible
        refresh_list()
        redraw()

    def del_sticker():
        if not (0 <= state['active'] < len(state['stickers'])):
            return
        state['stickers'].pop(state['active'])
        state['active'] = max(0, len(state['stickers']) - 1)
        refresh_list()
        redraw()

    # ---- 跨 webm 复制动画 ----
    # 场景：在 A 视频上给 PNG 打好了关键帧，切到 B 视频后同一张 PNG 还是新的
    # （只有 1 个起始帧）。这里把 A 的关键帧整套搬到 B，并按两边帧数比例重映射
    # 帧号——否则 71 帧里的关键帧放到 155 帧视频里会挤在前半段。

    def _rescale_kfs(src_kfs: list[Keyframe], src_n: int, dst_n: int) -> list[Keyframe]:
        out = []
        for k in src_kfs:
            if src_n > 1:
                f = 1 + (k.frame - 1) * (dst_n - 1) / (src_n - 1)
            else:
                f = 1
            f = int(round(max(1, min(f, dst_n))))
            out.append(Keyframe(f, k.cx, k.cy, k.scale, k.rot, k.alpha))
        # 去重（重映射后可能撞到同一帧），保留后面的
        dedup: dict[int, Keyframe] = {}
        for k in out:
            dedup[k.frame] = k
        return [dedup[f] for f in sorted(dedup)]

    def copy_anim():
        """把当前选中贴纸的关键帧动画复制到剪贴板（含源视频帧数）。

        注意：复制只在用户主动点「粘贴动画」或「同步到同PNG」时才生效。
        新加 PNG 不会自动继承，剪贴板会一直保留直到被新的复制覆盖或手动清除。
        """
        if not (0 <= state['active'] < len(state['stickers'])):
            info.set('先选中一个已 K 好动画的贴纸')
            return
        st = state['stickers'][state['active']]
        if not st.keyframes:
            info.set('该贴纸还没有关键帧')
            return
        n = len(state['store'].paths) if state['store'] else 1
        state['anim_clip'] = {
            'png_path': str(Path(st.png_path).resolve()),
            'name': st.name,
            'kfs': [Keyframe(**k.__dict__) for k in st.keyframes],
            'src_frames': n,
        }
        info.set(f'已复制动画：{st.name}（{len(st.keyframes)} 关键帧 / {n} 帧）'
                 '　→ 需手动点「粘贴动画」才会套用')

    def clear_anim_clip():
        """清空动画剪贴板，避免残留动画被误用。"""
        if state.get('anim_clip') is None:
            info.set('剪贴板本来就是空的')
            return
        name = state['anim_clip'].get('name', '')
        state['anim_clip'] = None
        info.set(f'已清空动画剪贴板（原为 {name}）')

    def _apply_clip_to_sticker(st: Sticker) -> bool:
        clip = state.get('anim_clip')
        if not clip:
            return False
        dst_n = len(state['store'].paths) if state['store'] else 1
        st.keyframes = _rescale_kfs(clip['kfs'], clip['src_frames'], dst_n)
        return True

    def paste_anim():
        """把剪贴板动画套到当前选中的贴纸，帧号按当前视频帧数重映射。"""
        if not state.get('anim_clip'):
            info.set('剪贴板里没有动画，先选中贴纸点「复制动画」')
            return
        if not (0 <= state['active'] < len(state['stickers'])):
            info.set('先在贴纸列表选中要粘贴的目标贴纸')
            return
        st = state['stickers'][state['active']]
        _apply_clip_to_sticker(st)
        refresh_list()
        redraw()
        info.set(f'已把动画粘贴到 {st.name}（{len(st.keyframes)} 关键帧，帧数 {len(state["store"].paths)}）')

    def paste_anim_all():
        """把剪贴板动画套到所有会话里同一张 PNG 的贴纸（跨视频批量同步）。"""
        clip = state.get('anim_clip')
        if not clip:
            info.set('剪贴板里没有动画，先复制')
            return
        target_png = clip['png_path']
        hit = 0
        cur_key = str(state['webm'].resolve()) if state['webm'] else None
        for key, sess in state['sessions'].items():
            if key == cur_key:
                continue
            dst_n = len(sess.store.paths)
            for st in sess.stickers:
                if str(Path(st.png_path).resolve()) == target_png:
                    st.keyframes = _rescale_kfs(clip['kfs'], clip['src_frames'], dst_n)
                    hit += 1
        # 当前会话里同名 PNG 也一起套上
        if state['store']:
            for st in state['stickers']:
                if str(Path(st.png_path).resolve()) == target_png:
                    _apply_clip_to_sticker(st)
        refresh_list()
        redraw()
        info.set(f'已同步到 {hit} 个其他视频的同一张 PNG')

    def paste_anim_to_active_png():
        """把动画套到当前视频里所有同 PNG 的贴纸。"""
        clip = state.get('anim_clip')
        if not clip:
            info.set('剪贴板里没有动画')
            return
        target_png = clip['png_path']
        n = 0
        for st in state['stickers']:
            if str(Path(st.png_path).resolve()) == target_png:
                _apply_clip_to_sticker(st)
                n += 1
        refresh_list()
        redraw()
        info.set(f'已套用动画到当前视频的 {n} 个同 PNG 贴纸')

    def toggle_play():
        state['playing'] = not state['playing']
        if state['playing']:
            playback['after'] = root.after(33, playback_step)
        elif playback['after']:
            try:
                root.after_cancel(playback['after'])
            except Exception:
                pass
            playback['after'] = None

    def playback_step():
        if not state['playing'] or not state['store']:
            return
        n = len(state['store'].paths)
        nf = state['frame'] + 1
        if nf > n:
            nf = 1
        set_frame(nf)
        playback['after'] = root.after(33, playback_step)

    def save_project():
        if not state['store']:
            return
        p = filedialog.asksaveasfilename(
            defaultextension='.json',
            initialfile=f"{state['webm'].stem}.sticker.json")
        if not p:
            return
        data = {
            'source': str(state['webm']),
            'spec': asdict(state['spec']),
            'stickers': [asdict(st) for st in (
                {'name': s.name, 'png_path': s.png_path,
                 'visible': s.visible, 'keyframes': s.keyframes}
                for s in state['stickers'])],
        }
        # asdict 在嵌套 dataclass 上直接可用，上面的生成器只是显式裁字段
        data['stickers'] = [
            {'name': s.name, 'png_path': s.png_path, 'visible': s.visible,
             'keyframes': [asdict(k) for k in s.keyframes]}
            for s in state['stickers']
        ]
        Path(p).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        messagebox.showinfo('已保存', p)

    def current_quality() -> Quality:
        return QUALITY_PRESETS.get(quality_var.get(), QUALITY_PRESETS['fast'])

    def snapshot_stickers(stickers: list[Sticker]) -> list[Sticker]:
        """给后台线程用的不可变快照，避免用户在导出中途改动引发竞态。"""
        out = []
        for st in stickers:
            kfs = [Keyframe(**asdict(k)) for k in st.keyframes]
            out.append(Sticker(name=st.name, png_path=st.png_path,
                               visible=st.visible, keyframes=kfs))
        return out

    def finish_export(done: int, failed: list[str], total: int):
        progress.set('空闲')
        if failed:
            messagebox.showwarning('导出完成（有失败）',
                                   f'成功 {done}/{total}\n' + '\n'.join(failed[:10]))
        else:
            messagebox.showinfo('导出完成', f'已导出 {done} 个文件')

    def worker(jobs, q: Quality):
        """后台串行导出，不碰 UI。

        FIX(批量导出 BUG 合集, 2026-10):
        1. 原实现所有视频共用「当前 webm」的贴纸（snapshot_stickers 只有一份），
           没有独立动画的视频会被套上别人的贴纸。现每个 job 自带 snap。
        2. 原 lambda 在循环里捕获 `src` 变量，progress 显示的是最后一个文件名。
           现用默认参数绑定当前值。
        3. 原实现输出与输入同目录且同名时可覆盖源文件，现加 dst!=src 保护。
        4. state['busy'] 只写一次（主线程 launch_export），worker 不再反复赋值。
        """
        done = 0
        failed = []
        try:
            for src, dst, snap, label in jobs:
                if not snap:
                    failed.append(f'{src.name}: 没有贴纸动画，跳过（先调好再导）')
                    root.after(0, lambda s=src, n=done + 1, t=len(jobs):
                               progress.set(f'跳过 {s.name} [{n}/{t}]'))
                    continue

                def on_prog(n, total, s=src):
                    root.after(0, lambda: progress.set(
                        f'{s.name}: {n} {total or "?"}'))
                root.after(0, lambda s=src, n=done + 1, t=len(jobs):
                           (info.set(f'导出 {s.name} [{n}/{t}]…'),
                            progress.set(f'导出 {s.name} [{n}/{t}]…')))
                try:
                    stream_export(src, snap, dst, q, progress=on_prog)
                    done += 1
                    root.after(0, lambda s=src, d=done, t=len(jobs):
                               progress.set(f'完成 {s.name} [{d}/{t}]'))
                except Exception as ex:
                    failed.append(f'{src.name}: {ex}')
        finally:
            # busy 必须复位，否则第二次导出被 do_export/do_export_dir 拦掉。
            state['busy'] = False
            root.after(0, lambda: finish_export(done, failed, len(jobs)))

    def do_export():
        if not state['store'] or state['busy']:
            return
        p = filedialog.asksaveasfilename(
            defaultextension='.webm',
            initialfile=state['webm'].stem + '_sticker.webm')
        if not p:
            return
        dst = Path(p)
        if _same_file(dst, state['webm']):
            messagebox.showerror('不能覆盖源文件', '输出路径与源文件相同，请换个名字')
            return
        snap = snapshot_stickers(state['stickers'])
        launch_export([(state['webm'], dst, snap, state['webm'].name)])

    def do_export_dir():
        """批量导出：每个 webm 用自己会话里的贴纸动画，互不干扰。"""
        if state['busy'] or len(state['queue']) < 1:
            return
        d = filedialog.askdirectory(title='批量导出到…')
        if not d:
            return
        jobs = []
        skipped = []
        for src in state['queue']:
            key = str(src.resolve())
            sess = state['sessions'].get(key)
            if sess is None or not sess.stickers:
                skipped.append(f'{src.name}（未调动画，跳过）')
                continue
            dst = Path(d) / (src.stem + '_sticker' + src.suffix)
            if _same_file(dst, src):
                skipped.append(f'{src.name}（输出名撞源，跳过）')
                continue
            jobs.append((src, dst, snapshot_stickers(sess.stickers), src.name))
        if skipped:
            info.set('跳过：' + '；'.join(skipped[:3]))
        if not jobs:
            messagebox.showinfo('没有可导出的', '队列里的视频都没有贴纸动画。\n'
                                '请逐个打开、加贴纸、打好关键帧后再批量导出。\n' +
                                ('跳过：\n' + '\n'.join(skipped[:6]) if skipped else ''))
            return
        launch_export(jobs)

    def _same_file(a: Path, b: Path) -> bool:
        try:
            return a.resolve() == b.resolve()
        except Exception:
            return str(a) == str(b)

    def launch_export(jobs: list[tuple]):
        q = current_quality()
        state['busy'] = True
        progress.set(f'导出 {len(jobs)} 个文件（{q.name}）…')
        info.set(f'导出 {len(jobs)} 个文件（{q.name}）…')
        threading.Thread(target=worker, args=(jobs, q), daemon=True).start()

    bf = ttk.Frame(ctrl)
    bf.pack(fill='x')
    for text, cmd in [('打开webm', open_webm), ('打开文件夹', open_folder),
                      ('加PNG入库', add_lib_png), ('批量加PNG', add_lib_multi),
                      ('删除贴纸', del_sticker),
                      ('显隐', toggle_visible), ('删webm', remove_queued)]:
        ttk.Button(bf, text=text, command=cmd).pack(side='left', padx=2)
    ttk.Separator(bf, orient='vertical').pack(side='left', fill='y', padx=6)
    for text, cmd in [('打关键帧(K)', set_keyframe_here), ('删关键帧', del_keyframe),
                      ('清空动画', clear_all_keyframes), ('播放/停', toggle_play)]:
        ttk.Button(bf, text=text, command=cmd).pack(side='left', padx=2)

    # 第二行：动画复制 + 导出（按钮多，单独一行避免挤爆）
    bf2 = ttk.Frame(ctrl)
    bf2.pack(fill='x', pady=(2, 0))
    ttk.Label(bf2, text='动画：').pack(side='left')
    for text, cmd in [('复制动画', copy_anim), ('粘贴动画', paste_anim),
                      ('同步到同PNG', paste_anim_all), ('清空剪贴板', clear_anim_clip)]:
        ttk.Button(bf2, text=text, command=cmd).pack(side='left', padx=2)
    ttk.Separator(bf2, orient='vertical').pack(side='left', fill='y', padx=6)
    ttk.Button(bf2, text='保存项目', command=save_project).pack(side='left', padx=2)
    ttk.Label(bf2, text='画质').pack(side='left', padx=(12, 2))
    qmap = quality_label_map()
    label_to_key = {v: k for k, v in qmap.items()}
    quality_display = tk.StringVar(value=qmap.get(quality_var.get(), qmap['fast']))

    def _on_quality_change(ev=None):
        quality_var.set(label_to_key.get(quality_display.get(), 'fast'))

    cb = ttk.Combobox(bf2, textvariable=quality_display, state='readonly', width=14,
                      values=list(qmap.values()))
    cb.bind('<<ComboboxSelected>>', _on_quality_change)
    cb.pack(side='left')
    ttk.Button(bf2, text='导出webm', command=do_export).pack(side='left', padx=(12, 2))
    ttk.Button(bf2, text='批量导出队列', command=do_export_dir).pack(side='left', padx=2)

    prog_row = ttk.Frame(root)
    prog_row.pack(fill='x', padx=6)
    ttk.Label(prog_row, text='导出').pack(side='left')
    bar = ttk.Progressbar(prog_row, mode='indeterminate', length=160)
    bar.pack(side='left', padx=6)
    ttk.Label(prog_row, textvariable=progress).pack(side='left')
    root.bind('k', lambda e: set_keyframe_here())
    sticker_list.bind('<<ListboxSelect>>', select_sticker)
    lib_list.bind('<<ListboxSelect>>', select_lib)
    for _t, _c in [('加到当前webm', apply_lib_to_current), ('删除库中PNG', remove_lib_png)]:
        ttk.Button(lib_btns, text=_t, command=_c).pack(side='top', fill='x', pady=1)
    refresh_lib()

    hint = ttk.Label(root, text='拖入文件/文件夹即可加入队列  |  拖动=移动  |  拖角=缩放  |  '
                                '滚轮=缩放  |  q/e=旋转  |  ←/→=逐帧  |  空格=播放  |  K=关键帧',
                     foreground='#888')
    hint.pack(pady=2)

    drop_target = [None]

    def _install_drop():
        drop_target[0] = enable_drop(root)
        if drop_target[0] is not None:
            print('mainloop alive, drop installed', flush=True)
        else:
            print('mainloop alive, no drop', flush=True)

    root.after(500, _install_drop)

    def poll_drop():
        try:
            t = drop_target[0]
            if t is not None and t.pending:
                batch = []
                while t.pending:
                    batch.append(t.pending.popleft())
                on_dropped_found([Path(x) for x in expand_paths(batch, ('.webm',))])
        except Exception as ex:
            print(f'drop expand failed: {ex}', flush=True)
        root.after(800, poll_drop)

    root.after(800, poll_drop)

    if getattr(args, 'input', None) and Path(args.input).exists():
        enqueue([Path(args.input)])
    root.update()
    redraw()
    print('gui ready', flush=True)
    root.mainloop()


def main() -> None:
    _setup_frozen_io()
    ap = argparse.ArgumentParser(description='webm sticker editor')
    ap.add_argument('--input', default='', help='预加载的 webm')
    ap.add_argument('--project', default='', help='项目 JSON（无 GUI 渲染用）')
    ap.add_argument('--export', default='', help='--project 时的输出 webm')
    ap.add_argument('--lossless', action='store_true', help='默认无损')
    ap.add_argument('--fast', action='store_true', help='GUI 默认用快速导出预设')
    ap.add_argument('--crf', type=int, default=20)
    args = ap.parse_args()

    if args.project:
        data = json.loads(Path(args.project).read_text(encoding='utf-8'))
        src = Path(data['source'])
        stickers = []
        for sd in data.get('stickers', []):
            st = Sticker(name=sd.get('name', ''), png_path=sd.get('png_path', ''),
                         visible=sd.get('visible', True))
            for kf in sd.get('keyframes', []):
                st.keyframes.append(Keyframe(**{k: kf[k] for k in
                                                 ('frame', 'cx', 'cy', 'scale', 'rot', 'alpha')
                                                 if k in kf}))
            stickers.append(st)
        out = Path(args.export) if args.export else src.with_name(src.stem + '_sticker.webm')
        td = Path(tempfile.mkdtemp(prefix='sticker_'))
        try:
            spec = probe_spec(src)
            print(f'OK {src}  {spec.width}x{spec.height} {spec.pix_fmt} {spec.fps_frac} {spec.codec}',
                  flush=True)
            q = QUALITY_PRESETS['lossless' if args.lossless else 'fast']
            q = replace(q, crf=args.crf)
            n = stream_export(src, stickers, out, q)
            print(f'OK {out}  {n} 帧', flush=True)
        finally:
            shutil.rmtree(td, ignore_errors=True)
        return

    if args.fast:
        args.lossless = False
    run_gui(args)


if __name__ == '__main__':
    main()



