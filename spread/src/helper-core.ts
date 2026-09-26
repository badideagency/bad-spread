// Yardımcı panele (cep-helper) derlenen TEK modül girişi: `npm run build:core` → cep-helper/js/spread-core.js (global SpreadCore).
// Premiere API'si YOK. Yardımcı paneldeki BAĞLA düğmesi grupları Spread'in kullandığı AYNI koddan (kimlik → sınıflama → düzenden
// gruplar → planla karşılaştırma) bulur; iki yol birbirinden sapamaz. `npm run check:core` derlenmiş dosyanın güncel olduğunu denetler.

export { classify } from "./classify";
export { compareLinkGroups, groupsFromLayout, layoutGroupItems, linkItemKey } from "./sessions";
export const CORE_VERSION = "0.3.3";
