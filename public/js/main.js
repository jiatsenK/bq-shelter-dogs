import { bindApp, startApp } from './app.js';
import { bindAnalysis } from './analysis.js';
import { bindGroups } from './group-stage.js';
import { bindFind } from './find.js';
import { bindFindDesk } from './find-desk.js';
import { bindActivities } from './activities.js';
import { startDesk } from './desk.js';
import './keyboard-viewport.js';

bindApp();
bindAnalysis();
bindGroups();
bindFind();
bindFindDesk();
bindActivities();
startDesk();
startApp();
