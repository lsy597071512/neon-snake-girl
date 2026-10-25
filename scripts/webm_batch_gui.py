from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
else:
    ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "webm_converter_cli.exe"


class App:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("透明 WebM 批处理器")
        self.root.geometry("900x620")
        self.events: queue.Queue[str] = queue.Queue()
        self.input_dir = tk.StringVar()
        self.output_dir = tk.StringVar()
        self.qa_dir = tk.StringVar()
        self.glob = tk.StringVar(value="*.mp4")
        self.key = tk.StringVar(value="auto")
        self.crf = tk.StringVar(value="20")
        self.fps = tk.StringVar(value="24")
        self.gpu = tk.BooleanVar(value=True)
        self.preserve = tk.BooleanVar(value=True)
        self.force = tk.BooleanVar(value=False)
        self._build()
        self.root.after(100, self._poll)

    def _build(self) -> None:
        outer = ttk.Frame(self.root, padding=18)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text="透明 WebM 批处理器", font=("Segoe UI", 18, "bold")).pack(anchor="w")
        ttk.Label(outer, text="固定 CRF 20；不使用无损模式；只抠除背景并保护角色与道具。").pack(anchor="w", pady=(4, 14))
        paths = ttk.LabelFrame(outer, text="路径", padding=10)
        paths.pack(fill="x")
        self._path(paths, 0, "输入目录", self.input_dir)
        self._path(paths, 1, "输出目录", self.output_dir)
        self._path(paths, 2, "QA 目录", self.qa_dir)
        opts = ttk.LabelFrame(outer, text="规范", padding=10)
        opts.pack(fill="x", pady=12)
        self._field(opts, 0, "文件筛选", self.glob)
        self._field(opts, 1, "CRF", self.crf)
        self._field(opts, 2, "帧率", self.fps)
        ttk.Label(opts, text="背景色").grid(row=0, column=2, padx=(24, 4), sticky="w")
        ttk.Combobox(opts, textvariable=self.key, values=("auto", "green", "blue", "magenta"), state="readonly", width=12).grid(row=0, column=3, sticky="w")
        ttk.Checkbutton(opts, text="GPU 推理", variable=self.gpu).grid(row=1, column=2, columnspan=2, sticky="w", padx=24)
        ttk.Checkbutton(opts, text="主体保护优先", variable=self.preserve).grid(row=2, column=2, columnspan=2, sticky="w", padx=24)
        ttk.Checkbutton(opts, text="覆盖已有文件", variable=self.force).grid(row=3, column=2, columnspan=2, sticky="w", padx=24)
        actions = ttk.Frame(outer)
        actions.pack(fill="x", pady=(0, 10))
        ttk.Button(actions, text="开始转换", command=self.start).pack(side="left")
        self.status = tk.StringVar(value="待命")
        ttk.Label(actions, textvariable=self.status).pack(side="right")
        frame = ttk.LabelFrame(outer, text="日志", padding=6)
        frame.pack(fill="both", expand=True)
        self.log = tk.Text(frame, state="disabled", wrap="word", background="#111827", foreground="#d1fae5")
        self.log.pack(fill="both", expand=True)

    def _path(self, parent: ttk.Frame, row: int, label: str, var: tk.StringVar) -> None:
        ttk.Label(parent, text=label, width=10).grid(row=row, column=0, sticky="w", pady=4)
        ttk.Entry(parent, textvariable=var).grid(row=row, column=1, sticky="ew", padx=8)
        ttk.Button(parent, text="选择", command=lambda: self.choose(var)).grid(row=row, column=2)
        parent.columnconfigure(1, weight=1)

    def _field(self, parent: ttk.Frame, row: int, label: str, var: tk.StringVar) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=3)
        ttk.Entry(parent, textvariable=var, width=14).grid(row=row, column=1, sticky="w", padx=8)

    def choose(self, var: tk.StringVar) -> None:
        value = filedialog.askdirectory()
        if value:
            var.set(value)
            if var is self.input_dir and not self.output_dir.get():
                self.output_dir.set(str(Path(value) / "webm_out_crf20"))

    def write(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def start(self) -> None:
        source = Path(self.input_dir.get())
        if not source.is_dir():
            messagebox.showerror("错误", "请选择有效的输入目录")
            return
        try:
            crf = int(self.crf.get())
            if crf != 20:
                raise ValueError
            float(self.fps.get())
        except ValueError:
            messagebox.showerror("错误", "本工具固定使用 CRF 20；帧率必须为数字")
            return
        output = Path(self.output_dir.get() or source / "webm_out_crf20")
        qa = Path(self.qa_dir.get() or source / "webm_qa_crf20")
        if not CLI.exists():
            messagebox.showerror("错误", f"找不到转换引擎：{CLI}")
            return
        cmd = [str(CLI), "--input-dir", str(source), "--output-dir", str(output), "--qa-dir", str(qa), "--glob", self.glob.get() or "*.mp4", "--output-template", "{stem}.webm", "--key-color", self.key.get(), "--fps", self.fps.get(), "--crf", "20"]
        if self.gpu.get(): cmd.append("--gpu")
        if self.preserve.get(): cmd.append("--preserve-subject")
        if self.force.get(): cmd.append("--force")
        self.status.set("转换中")
        self.write("$ " + " ".join(cmd))
        threading.Thread(target=self.run, args=(cmd,), daemon=True).start()

    def run(self, cmd: list[str]) -> None:
        try:
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", cwd=ROOT)
            assert p.stdout is not None
            for line in p.stdout:
                self.events.put(line.rstrip())
            self.events.put(f"__DONE__{p.wait()}")
        except Exception as exc:
            self.events.put(f"__ERROR__{exc}")

    def _poll(self) -> None:
        try:
            while True:
                line = self.events.get_nowait()
                if line.startswith("__DONE__"):
                    self.status.set("完成" if line.endswith("0") else "存在失败项")
                elif line.startswith("__ERROR__"):
                    self.status.set("错误")
                self.write(line.replace("__ERROR__", "ERROR: ").replace("__DONE__", "转换结束，退出码 "))
        except queue.Empty:
            pass
        self.root.after(100, self._poll)


def main() -> None:
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
