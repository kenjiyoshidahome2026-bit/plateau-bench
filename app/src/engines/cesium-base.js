// cesium を読む前に置き場を教える（Workers・Assets などは public/cesium のリンク経由で配る）
window.CESIUM_BASE_URL = new URL("./cesium/", location.href).href;
