// Yardımcı panele (cep-helper) derlenen TEK modül girişi: `npm run build:core` → cep-helper/js/spread-core.js (global SpreadCore).
// Premiere API'si YOK. Yardımcı paneldeki BAĞLA düğmesi grupları Spread'in kullandığı AYNI koddan (kimlik → sınıflama → düzenden
// gruplar → planla karşılaştırma) bulur; iki yol birbirinden sapamaz. `npm run check:core` derlenmiş dosyanın güncel olduğunu denetler.

export { classify } from "./classify";
export { compareLinkGroups, groupsFromLayout, layoutGroupItems, linkItemKey, linkItemOf, reduceToPresent } from "./sessions";
export { channelOutliers, channelTypeName } from "./channels";
export const CORE_VERSION = "1.0.0";
