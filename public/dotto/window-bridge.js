// Auto-generated bridge for the ~107 function names called by name from inline
// HTML event attributes (onclick="fn(...)" etc.) — both the static markup fragments
// (content/fragments/*.html) and HTML strings dotto-script.js itself generates. Classic scripts'
// top-level `function` declarations attach to `window` automatically, which is why these always
// worked before; real ES modules do not do this, so each one needs an explicit assignment here.
// Regenerate by re-running the grep this was built from (see PHASE2_ROADMAP.md Phase 1) rather
// than hand-editing — the list has to stay provably complete against the actual call sites.
// (handleColNameKeydown/openTableCellContextMenu/renameTableColumn/setLastFocusedCell were found
// missing from the original generation — the static-source table's cell-header wiring — and added
// by hand here since no automated regeneration tooling exists in this environment; a real re-run
// of the original grep would be the more thorough fix if that tooling is ever set up.
// openChatsPanel/openHubCollabPanel/openWaypointsPanel were hand-added the same way but later
// REMOVED again — Waypoints/Collaborations/the outline tree are dedicated permanent rail icons now
// (#dotto-rail, top-bar.html), wired directly via addEventListener in panels-hamburger.js rather
// than being called by name from an inline onclick attribute, so they no longer belong here.)

import { handleSearchFocus, handleSearchInput, showAiListView } from './ai-assistant-suggestions.js';
import { addTask, editEmbed, removeTask, toggleTask, updateTaskDeadline, updateTaskText } from './cards-misc.js';
import { prepareAdd } from './copy-paste.js';
import { handleCollabSearch, handleMsgSearch, openCollabPanel } from './friends-presence.js';
import { addGameColumnSlot, fcFlip, fcRate, fcToggleMode, removeGameColumnSlot, setGameColumnSlot, trCheck, trFocusInput, trNext, trToggleMode, trUpdateInput } from './games-flashcard-typeright.js';
import { hmenuAction } from './hamburger-collab.js';
import { deleteContextColumn, deleteContextRow, hideCanvasContextMenu, highlightContextColumn, highlightContextRow, openTableCellContextMenu, redo, undo } from './history-autosave.js';
import { blurPublishFlowName, commitItemDetailDesc, commitItemDetailTitle, confirmPublishFlow, deleteDetailDraft, focusPublishFlowName, onItemDetailFieldChange, startPublishFlow, unpublishDetailItem, updateDetailItem } from './library-publish.js';
import { broadcastEditingState, closeConvo, closeSharedCanvasView, sendMsg, setTitleLevel } from './live-presence.js';
import { closeMarketDetail, deployPurchasedTemplate, handleMarketplaceSearch, purchaseCurrentMarketItem } from './marketplace.js';
import { clearMedia, setMediaFromLink, triggerMediaUpload } from './media-pdf-epub.js';
import { handleFilesSearch, handleHubCollabSearch, handleSourcesSearch, handleWaypointsSearch } from './panels-hamburger.js';
import { closeDotbotUpgradeModal, closePricingOverlay, openPricingOverlay, showProfileMainView, showProfileSettingsView } from './profile-achievements-pricing.js';
import { setTableAlign } from './card-shortcuts.js';
import { handleOutlineSearch } from './outline-tree.js';
import { openCellAddMenu } from './source-buttons-cursor-mode.js';
import { addTableCol, addTableRow, handleCellMouseDown, handleColNameKeydown, handleTableKeydown, renameTableColumn, setLastFocusedCell, startCellAudioRecording, stopCellAudioRecording, triggerCellAudioUpload, triggerCellImageUpload, updateTableCell } from './source-table.js';
import { closeCellTagPicker, closeTagContextMenu, commitTagRename, createTagFromCellPicker, deleteActiveTag, handleTagRenameKeydown, openTagContextMenu, startRenameActiveTag, toggleCellTag, triggerSourceUpload } from './source-tags-ai.js';
import { createNewSource } from './srs-connections-core.js';
import { clearSearchCardContext, closeSearchCardsModal, filterShelfRows, handleShelfSourceRowClick, openSearchCardsModal, runNotificationAction, setFilterMode, shelfSelectSession, startRenameShelfName, startRenameShelfSourceRow, swTogglePause, swToggleRun, toggleFilterTag } from './stopwatch-search-notifications.js';

window.addGameColumnSlot = addGameColumnSlot;
window.addTableCol = addTableCol;
window.addTableRow = addTableRow;
window.addTask = addTask;
window.blurPublishFlowName = blurPublishFlowName;
window.broadcastEditingState = broadcastEditingState;
window.clearMedia = clearMedia;
window.clearSearchCardContext = clearSearchCardContext;
window.closeCellTagPicker = closeCellTagPicker;
window.closeConvo = closeConvo;
window.closeDotbotUpgradeModal = closeDotbotUpgradeModal;
window.closeMarketDetail = closeMarketDetail;
window.closePricingOverlay = closePricingOverlay;
window.closeSearchCardsModal = closeSearchCardsModal;
window.closeSharedCanvasView = closeSharedCanvasView;
window.closeTagContextMenu = closeTagContextMenu;
window.commitItemDetailDesc = commitItemDetailDesc;
window.commitItemDetailTitle = commitItemDetailTitle;
window.commitTagRename = commitTagRename;
window.confirmPublishFlow = confirmPublishFlow;
window.createNewSource = createNewSource;
window.createTagFromCellPicker = createTagFromCellPicker;
window.deleteActiveTag = deleteActiveTag;
window.deleteContextColumn = deleteContextColumn;
window.deleteContextRow = deleteContextRow;
window.deleteDetailDraft = deleteDetailDraft;
window.deployPurchasedTemplate = deployPurchasedTemplate;
window.editEmbed = editEmbed;
window.fcFlip = fcFlip;
window.fcRate = fcRate;
window.fcToggleMode = fcToggleMode;
window.filterShelfRows = filterShelfRows;
window.focusPublishFlowName = focusPublishFlowName;
window.handleCellMouseDown = handleCellMouseDown;
window.handleCollabSearch = handleCollabSearch;
window.handleColNameKeydown = handleColNameKeydown;
window.handleFilesSearch = handleFilesSearch;
window.handleHubCollabSearch = handleHubCollabSearch;
window.handleMarketplaceSearch = handleMarketplaceSearch;
window.handleMsgSearch = handleMsgSearch;
window.handleOutlineSearch = handleOutlineSearch;
window.handleSearchFocus = handleSearchFocus;
window.handleSearchInput = handleSearchInput;
window.handleShelfSourceRowClick = handleShelfSourceRowClick;
window.handleSourcesSearch = handleSourcesSearch;
window.handleTableKeydown = handleTableKeydown;
window.handleTagRenameKeydown = handleTagRenameKeydown;
window.handleWaypointsSearch = handleWaypointsSearch;
window.hideCanvasContextMenu = hideCanvasContextMenu;
window.highlightContextColumn = highlightContextColumn;
window.highlightContextRow = highlightContextRow;
window.hmenuAction = hmenuAction;
window.onItemDetailFieldChange = onItemDetailFieldChange;
window.openCellAddMenu = openCellAddMenu;
window.openCollabPanel = openCollabPanel;
window.openPricingOverlay = openPricingOverlay;
window.openSearchCardsModal = openSearchCardsModal;
window.openTableCellContextMenu = openTableCellContextMenu;
window.openTagContextMenu = openTagContextMenu;
window.prepareAdd = prepareAdd;
window.purchaseCurrentMarketItem = purchaseCurrentMarketItem;
window.redo = redo;
window.removeGameColumnSlot = removeGameColumnSlot;
window.removeTask = removeTask;
window.renameTableColumn = renameTableColumn;
window.runNotificationAction = runNotificationAction;
window.sendMsg = sendMsg;
window.setFilterMode = setFilterMode;
window.setGameColumnSlot = setGameColumnSlot;
window.setLastFocusedCell = setLastFocusedCell;
window.setMediaFromLink = setMediaFromLink;
window.setTableAlign = setTableAlign;
window.setTitleLevel = setTitleLevel;
window.shelfSelectSession = shelfSelectSession;
window.showAiListView = showAiListView;
window.showProfileMainView = showProfileMainView;
window.showProfileSettingsView = showProfileSettingsView;
window.startCellAudioRecording = startCellAudioRecording;
window.startPublishFlow = startPublishFlow;
window.startRenameActiveTag = startRenameActiveTag;
window.startRenameShelfName = startRenameShelfName;
window.startRenameShelfSourceRow = startRenameShelfSourceRow;
window.stopCellAudioRecording = stopCellAudioRecording;
window.swTogglePause = swTogglePause;
window.swToggleRun = swToggleRun;
window.toggleCellTag = toggleCellTag;
window.toggleFilterTag = toggleFilterTag;
window.toggleTask = toggleTask;
window.trCheck = trCheck;
window.trFocusInput = trFocusInput;
window.trNext = trNext;
window.trToggleMode = trToggleMode;
window.trUpdateInput = trUpdateInput;
window.triggerCellAudioUpload = triggerCellAudioUpload;
window.triggerCellImageUpload = triggerCellImageUpload;
window.triggerMediaUpload = triggerMediaUpload;
window.triggerSourceUpload = triggerSourceUpload;
window.undo = undo;
window.unpublishDetailItem = unpublishDetailItem;
window.updateDetailItem = updateDetailItem;
window.updateTableCell = updateTableCell;
window.updateTaskDeadline = updateTaskDeadline;
window.updateTaskText = updateTaskText;
