# -*- coding: utf-8 -*-
"""调教娇喘角色花名册：characterId ↔ stem / 音色 / 锁音台词。

权威音色定义仍在 src/ai/voice/characterVoices.ts；此处仅供批处理脚本使用。
改音色或台词时：先改 TS，再同步本文件。
"""
from __future__ import annotations

from typing import Literal, TypedDict


TtsPath = Literal["vc", "instruct", "flash"]


class MoanChar(TypedDict):
    character_id: str
    name_zh: str
    stem: str
    voice: str
    voice_label: str
    tts_path: TtsPath
    instruction: str
    timbre_lines: list[str]
    # 若 False，静帧未进 Comfy input，批处理跳过
    stills_ready: bool


# 倒序：稀有度高 → 低（与调教 v4 批处理习惯一致）
ROSTER_ORDER: list[str] = [
    "outercore",
    "stellar",
    "ironrain",
    "dustblade",
    "skyshard",
    "pulse",
    "frostline",
    "wireguard",
    "prismrift",
    "mirror",
    "heartforge",
    "neoncoil",
    "ashcrow",
]

CHARACTERS: dict[str, MoanChar] = {
    "ashcrow": {
        "character_id": "ashcrow",
        "name_zh": "苍羽·澪",
        "stem": "SR01_2",
        "voice": "Cherry",
        "voice_label": "芊悦·明亮女性",
        "tts_path": "flash",  # instruct 系模型已下线（2026-10 实测 404），暂用 flash 版 Cherry
        "instruction": (
            "请用十八岁冷静开路少女的嗓音说话，音色偏女性、清晰柔韧，吐字干脆但不中性不沙哑；"
            "像突击手确认风向，年轻女声，不要撒娇粘人，不要老气或御姐感。"
        ),
        "timbre_lines": [
            "风向还行。你跟紧，别掉队。",
            "路开了。饭盒？回营再说。",
            "跟上。别落单。",
        ],
        "stills_ready": True,  # SR01_2_p1_s*.png（来自 tiaojiao_dadibeifen/Asset-04z95vsobhbt.png 缩放）
    },
    "neoncoil": {
        "character_id": "neoncoil",
        "name_zh": "苍斩·凛",
        "stem": "SR01_3",
        "voice": "Katerina",
        "voice_label": "卡捷琳娜·空灵疏离",
        "tts_path": "flash",
        "instruction": "",
        "timbre_lines": [
            "完成。",
            "你先。",
            "别出声。过来。",
        ],
        "stills_ready": True,
    },
    "heartforge": {
        "character_id": "heartforge",
        "name_zh": "白楯·芹奈",
        "stem": "SR02_1",
        "voice": "Serena",
        "voice_label": "苏瑶·温柔小姐姐",
        "tts_path": "instruct",
        "instruction": (
            "请用十九岁温柔能干的少女嗓音说话，暖、稳、护心，像贤内助关心队友，不要刻薄，也不要稚气童声。"
        ),
        "timbre_lines": [
            "我留了热的。手洗一下再来。",
            "都还在，就好。",
            "小心。让我挡一下。",
        ],
        "stills_ready": True,
    },
    "mirror": {
        "character_id": "mirror",
        "name_zh": "银绯·玲",
        "stem": "SR03_1",
        "voice": "Maia",
        "voice_label": "四月·知性温柔",
        "tts_path": "instruct",
        "instruction": (
            "请用十八岁疏离理性的少女嗓音说话，语速偏稳、带一点距离感，像光学观测在报概率，不要傲娇，不要成熟御姐。"
        ),
        "timbre_lines": [
            "热量缺口可补。十分钟后汇合。",
            "概率闭合。",
            "结论已出。别打断观测。",
        ],
        "stills_ready": True,
    },
    "prismrift": {
        "character_id": "prismrift",
        "name_zh": "焰甲·朱里",
        "stem": "SR04_1",
        "voice": "Vivian",
        "voice_label": "十三·冷静小暴躁",
        "tts_path": "instruct",
        "instruction": (
            "请用二十岁务实重炮少女的嗓音，数字感强、少闲聊，像确认目标距离；可用一点干脆小暴躁的锋芒，干练但不沉闷老成。"
        ),
        "timbre_lines": [
            "膛温未降。十二分钟后。",
            "目标清除。",
            "距离确认。别挡炮线。",
        ],
        "stills_ready": True,
    },
    "wireguard": {
        "character_id": "wireguard",
        "name_zh": "黄狐·萤",
        "stem": "SR05_1",
        "voice": "Cherry",
        "voice_label": "芊悦·明亮俏皮",
        "tts_path": "instruct",
        "instruction": (
            "请用十八岁戏谑嘴毒的狐耳少女嗓音，语速偏快、尾音可上扬，玩笑里藏警戒，年轻明亮，不要御姐。"
        ),
        "timbre_lines": [
            "哟，指挥官终于想起碳基也要加油？",
            "哈，就这？",
            "滤芯柜见——别用手乱摸。",
        ],
        "stills_ready": True,
    },
    "frostline": {
        "character_id": "frostline",
        "name_zh": "夜爪·黑织",
        "stem": "SSR01_1",
        "voice": "qwen-tts-vc-yinse_pulse-voice-20260814110227791-7aaf",
        "voice_label": "yinse 复刻·夜爪（沉）",
        "tts_path": "vc",
        "instruction": (
            "请用二十一岁清冷夜袭少女的嗓音：在此音色上刻意压沉、压低、少亮少尖；"
            "吐字克制、气声偏暗；亲密话也只用低沉气声，禁止甜腻上扬、禁止小孩声或尖亮。"
        ),
        "timbre_lines": [
            "……不必。你去。",
            "结束了。",
            "……可以。别吵。",
        ],
        "stills_ready": True,
    },
    "pulse": {
        "character_id": "pulse",
        "name_zh": "翠翼·铃",
        "stem": "SSR02_1",
        "voice": "Nini",
        "voice_label": "Nini·明朗频谱",
        "tts_path": "instruct",
        "instruction": (
            "请用十八岁明朗频谱少女的嗓音，健谈自然、略带上扬，但不要小孩声、不要又尖又亮；"
            "像同龄队友聊天，青年女声，禁止童声和刺耳尖音。"
        ),
        "timbre_lines": [
            "好耶！我去占座——大厅回声我听得见你脚步。",
            "耶，清干净啦！",
            "节拍对上了，继续！",
        ],
        "stills_ready": True,
    },
    "skyshard": {
        "character_id": "skyshard",
        "name_zh": "冰华·雫",
        "stem": "SSR03_1",
        "voice": "qwen-tts-vc-yinse_skyshard-voice-20260814110224868-a391",
        "voice_label": "yinse 复刻·冰华",
        "tts_path": "vc",
        "instruction": (
            "请用十八岁温软共情少女的嗓音，轻声、多关心，像把硬壳留给战斗，甜美年轻，不要童声过头。"
        ),
        "timbre_lines": [
            "好……你还好吗？手冻吗？我坐你旁边就好。",
            "还好吗？冷的话，靠过来一点。我在。",
            "一起就好。你不用一个人忍。",
        ],
        "stills_ready": True,
    },
    "dustblade": {
        "character_id": "dustblade",
        "name_zh": "绯尾·椿",
        "stem": "SSR04_1",
        "voice": "Chelsie",
        "voice_label": "千雪·二次元柔刃",
        "tts_path": "instruct",
        "instruction": (
            "请用十九岁沙漠猎手少女的嗓音，语速稍快、利落自然；温柔微笑里带一点危险，句尾可轻扬，"
            "不是娇羞傲娇，也不是老气风情。"
        ),
        "timbre_lines": [
            "嗯……一起吧。你坐我看得见出口的那边，好吗？",
            "晚安。",
            "别怕。出口在这边。",
        ],
        "stills_ready": True,
    },
    "ironrain": {
        "character_id": "ironrain",
        "name_zh": "橙铠·琥珀",
        "stem": "SSR05_1",
        "voice": "Mia",
        "voice_label": "乖小妹·温软甜美",
        "tts_path": "instruct",
        "instruction": (
            "请用十八岁温软共情少女的嗓音，轻声、多关心，像把硬壳留给战斗，甜美年轻，不要童声过头。"
        ),
        "timbre_lines": [
            "温度还高。十分钟。你先去……凉了再说。",
            "热平衡，达标。",
            "等等。工序还没完。",
        ],
        "stills_ready": True,
    },
    "stellar": {
        "character_id": "stellar",
        "name_zh": "光轮·天音",
        "stem": "UR03_1",
        "voice": "Seren",
        "voice_label": "小婉·低回舒缓",
        "tts_path": "instruct",
        "instruction": (
            "请用外表十九岁的原型决战少女嗓音，疏离、短句像宣判，少人称；"
            "声线可低回舒缓但仍青年女声略飘，不要成熟播音腔或御姐感。"
        ),
        "timbre_lines": [
            "补给窗口开启。执行。",
            "句号。",
            "节点确认。接触窗口。",
        ],
        "stills_ready": True,
    },
    "outercore": {
        "character_id": "outercore",
        "name_zh": "橙兔·美羽",
        "stem": "UR04_1",
        "voice": "Momo",
        "voice_label": "茉兔·甜萌搞怪",
        "tts_path": "instruct",
        "instruction": (
            "请用十八岁星种兔少女的嗓音，俏皮卖萌接梗，内核可瞬间转冷；年轻甜萌，禁止老气或御姐。"
        ),
        "timbre_lines": [
            "走走走！我兔也要充电——你敢抢胡萝卜徽章试试？",
            "只咬坏人哦。",
            "试试？徽章借你摸一下下。",
        ],
        "stills_ready": True,
    },
}


def get_char(character_id: str) -> MoanChar:
    if character_id not in CHARACTERS:
        raise KeyError(f"unknown character_id={character_id}; known={list(CHARACTERS)}")
    return CHARACTERS[character_id]


def list_ready(skip_ids: set[str] | None = None) -> list[MoanChar]:
    skip_ids = skip_ids or set()
    out: list[MoanChar] = []
    for cid in ROSTER_ORDER:
        c = CHARACTERS[cid]
        if not c["stills_ready"]:
            continue
        if cid in skip_ids:
            continue
        out.append(c)
    return out
