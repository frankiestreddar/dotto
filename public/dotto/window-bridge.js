// Auto-generated bridge for the ~107 function names called by name from inline
// HTML event attributes (onclick="fn(...)" etc.) — both the static markup fragments
// (content/fragments/*.html) and HTML strings dotto-script.js itself generates. Classic scripts'
// top-level `function` declarations attach to `window` automatically, which is why these always
// worked before; real ES modules do not do this, so each one needs an explicit assignment here.
// Regenerate by re-running the grep this was built from (see PHASE2_ROADMAP.md Phase 1) rather
// than hand-editing — the list has to stay provably complete against the actual call sites.
// (openTableCellContextMenu was found missing from the original generation — the static-source
// table's cell-header wiring — and added by hand here since no automated regeneration tooling
// exists in this environment; a real re-run of the original grep would be the more thorough fix if
// that tooling is ever set up.
// openChatsPanel/openHubCollabPanel/openWaypointsPanel were hand-added the same way but later
// REMOVED again — Waypoints/Collaborations/the outline tree are dedicated permanent rail icons now
// (#dotto-rail, top-bar.html), wired directly via addEventListener in app/dotto/lib/panelsHamburger.ts rather
// than being called by name from an inline onclick attribute, so they no longer belong here.
// handleColNameKeydown/renameTableColumn/setLastFocusedCell (also hand-added alongside
// openTableCellContextMenu originally) were REMOVED again too, for a different reason — Phase 4.4
// moved their owning file (source-table.js) to app/dotto/lib/sourceTable.ts, which now sets these
// as plain globals directly, same convention every other inline-onclick target that file owns
// already established.)

import { handleSearchFocus, handleSearchInput, showAiListView } from './ai-assistant-suggestions.js';
import { addTask, editEmbed, removeTask, toggleTask, updateTaskDeadline, updateTaskText } from './cards-misc.js';
import { handleCollabSearch, handleMsgSearch, openCollabPanel } from './friends-presence.js';
import { hmenuAction } from './hamburger-collab.js';
import { blurPublishFlowName, commitItemDetailDesc, commitItemDetailTitle, confirmPublishFlow, deleteDetailDraft, focusPublishFlowName, onItemDetailFieldChange, startPublishFlow, unpublishDetailItem, updateDetailItem } from './library-publish.js';
import { closeDotbotUpgradeModal, closePricingOverlay, openPricingOverlay, showProfileMainView, showProfileSettingsView } from './profile-achievements-pricing.js';
import { setTableAlign } from './card-shortcuts.js';
import { closeCellTagPicker, closeTagContextMenu, commitTagRename, createTagFromCellPicker, deleteActiveTag, handleTagRenameKeydown, openTagContextMenu, startRenameActiveTag, toggleCellTag, triggerSourceUpload } from './source-tags-ai.js';
import { createNewSource } from './srs-connections-core.js';

window.addTask = addTask;
window.blurPublishFlowName = blurPublishFlowName;
window.closeCellTagPicker = closeCellTagPicker;
window.closeDotbotUpgradeModal = closeDotbotUpgradeModal;
window.closePricingOverlay = closePricingOverlay;
window.closeTagContextMenu = closeTagContextMenu;
window.commitItemDetailDesc = commitItemDetailDesc;
window.commitItemDetailTitle = commitItemDetailTitle;
window.commitTagRename = commitTagRename;
window.confirmPublishFlow = confirmPublishFlow;
window.createNewSource = createNewSource;
window.createTagFromCellPicker = createTagFromCellPicker;
window.deleteActiveTag = deleteActiveTag;
window.deleteDetailDraft = deleteDetailDraft;
window.editEmbed = editEmbed;
window.focusPublishFlowName = focusPublishFlowName;
window.handleCollabSearch = handleCollabSearch;
window.handleMsgSearch = handleMsgSearch;
window.handleSearchFocus = handleSearchFocus;
window.handleSearchInput = handleSearchInput;
window.handleTagRenameKeydown = handleTagRenameKeydown;
window.hmenuAction = hmenuAction;
window.onItemDetailFieldChange = onItemDetailFieldChange;
window.openCollabPanel = openCollabPanel;
window.openPricingOverlay = openPricingOverlay;
window.openTagContextMenu = openTagContextMenu;
window.removeTask = removeTask;
window.setTableAlign = setTableAlign;
window.showAiListView = showAiListView;
window.showProfileMainView = showProfileMainView;
window.showProfileSettingsView = showProfileSettingsView;
window.startPublishFlow = startPublishFlow;
window.startRenameActiveTag = startRenameActiveTag;
window.toggleCellTag = toggleCellTag;
window.toggleTask = toggleTask;
window.triggerSourceUpload = triggerSourceUpload;
window.unpublishDetailItem = unpublishDetailItem;
window.updateDetailItem = updateDetailItem;
window.updateTaskDeadline = updateTaskDeadline;
window.updateTaskText = updateTaskText;
