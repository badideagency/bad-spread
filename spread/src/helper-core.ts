// Yardımcı panele (cep-helper) derlenen TEK modül girişi: `npm run build:core` → cep-helper/js/spread-core.js (global SpreadCore).
// Premiere API'si YOK. Yardımcı paneldeki BAĞLA düğmesi grupları Spread'in kullandığı AYNI koddan (kimlik → sınıflama → düzenden
// gruplar → planla karşılaştırma) bulur; iki yol birbirinden sapamaz. `npm run check:core` derlenmiş dosyanın güncel olduğunu denetler.

export { classify } from "./classify";
export { compareLinkGroups, groupsFromLayout, layoutGroupItems, linkItemKey, linkItemOf, reduceToPresent } from "./sessions";
export { channelOutliers, channelTypeName } from "./channels";
// v1.4.0 SENKRON: ses eşleştirme motoru (yardımcı js/senkron.js çözülmüş sesleri buraya verir)
export { solve as senkronSolve, clockFromName as senkronClock, DEFAULT_OPTS as SENKRON_OPTS } from "./senkron";
export const CORE_VERSION = "1.1.0";
