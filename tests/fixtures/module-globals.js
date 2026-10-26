import { acceptSettings } from '../../public/js/feature-settings.js';
const defaultSettings = {revision:1,values:Object.fromEntries(['showActivities','showQuality','showUpdates','editIntro','editPhoto','editRest','editActivity','editFixedCare','editStays'].map(k=>[k,true]))};
acceptSettings(defaultSettings);
if (!window.__BQ_FEATURE_TEST__) apiModule.BQApi.featureSettings = async () => ({ok:true,data:defaultSettings});
// Compatibility for existing assertions only. Production pages never load this adapter.
import * as appModule from '../../public/js/app.js';
import * as detailModule from '../../public/js/detail.js';
import * as sheetAppendModule from '../../public/js/sheet-append.js';
import * as detailFixedCareModule from '../../public/js/detail-fixed-care.js';
import * as detailRestModule from '../../public/js/detail-rest.js';
import * as detailIntroModule from '../../public/js/detail-intro.js';
import * as detailStaysModule from '../../public/js/detail-stays.js';
import * as analysisModule from '../../public/js/analysis.js';
import * as groupsModule from '../../public/js/group-stage.js';
import * as findModule from '../../public/js/find.js';
import * as activitiesModule from '../../public/js/activities.js';
import * as tourModule from '../../public/js/tour.js';
import * as photoModule from '../../public/js/photo.js';
import * as walkUiModule from '../../public/js/walk-ui.js';
import * as welcomeModule from '../../public/js/welcome.js';
import * as favoritesModule from '../../public/js/favorites.js';
import * as detailViewportModule from '../../public/js/detail-viewport.js';
import * as walkFlowModule from '../../public/js/walk-flow.js';
import * as walkRegistrationModule from '../../public/js/walk-registration.js';
import * as detailEditorModule from '../../public/js/detail-editor.js';
import * as datesModule from '../../public/js/dates.js';
import * as apiModule from '../../public/js/api.js';
import * as storeModule from '../../public/js/store.js';
import * as siteModule from '../../public/js/site-config.js';
import * as uiKitModule from '../../public/js/ui-kit.js';
import * as dogStatusModule from '../../public/js/dog-status.js';

export function expose(modules) {
  for (const module of modules) for (const [name, value] of Object.entries(module)) {
    if (name.endsWith('State')) {
      for (const key of Object.keys(value)) Object.defineProperty(window, key, { configurable: true, get: () => value[key], set: next => { value[key] = next; } });
    } else if (!(name in window)) Object.defineProperty(window, name, { configurable: true, get: () => module[name] });
  }
}

expose([appModule, detailModule, sheetAppendModule, detailFixedCareModule, detailRestModule, detailIntroModule, detailStaysModule, analysisModule, groupsModule, findModule, activitiesModule, tourModule, photoModule, walkUiModule, welcomeModule, favoritesModule, detailViewportModule, walkFlowModule, walkRegistrationModule, detailEditorModule, datesModule, apiModule, storeModule, siteModule, uiKitModule, dogStatusModule]);
