/**
 * 唯一的 release 签名期望指纹（单一来源）。
 *
 * 所有 release 包必须由这一把证书签名，否则玩家无法覆盖安装（热更），
 * 只能卸载重装 → 存档丢失。换钥匙是不可逆操作。
 *
 * 来源：android/keystore/README.md「首次启用纪要（2026-10-18）」。
 * 任何"换电脑后指纹变了"的问题，都先在这里比对该值。
 */
const EXPECTED_RELEASE_SHA256 =
  'A7AC65C2EE91698133034169C9A51F526D5045BE2C76468FFC60E6293E8AF240';

module.exports = { EXPECTED_RELEASE_SHA256 };
