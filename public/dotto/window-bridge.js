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
// of the original grep would be the more thorough fix if that tooling is ever set up. openChatsPanel
// — the sidebar Chats panel's onclick, content/fragments/hamburger-stack.html — added by hand the
// same way, for the same reason: it's a new call site added after this file was last generated.)

import { handleAddMenuSearchInput, newSourceClicked, switchAddTab, toggleAddMenuSearch } from './add-menu.js';
import { handleSearchFocus, handleSearchInput } from './ai-assistant-suggestions.js';
import { addTask, editEmbed, removeTask, toggleTask, updateTaskDeadline, updateTaskText } from './cards-misc.js';
import { prepareAdd } from './copy-paste.js';
import { handleCollabSearch, handleMsgSearch, openCollabPanel } from './friends-presence.js';
import { addGameColumnSlot, fcFlip, fcRate, fcToggleMode, removeGameColumnSlot, setGameColumnSlot, trCheck, trFocusInput, trNext, trToggleMode, trUpdateInput } from './games-flashcard-typeright.js';
import { hmenuAction } from './hamburger-collab.js';
import { deleteContextColumn, deleteContextRow, hideCanvasContextMenu, highlightContextColumn, highlightContextRow, openTableCellContextMenu, redo, undo } from './history-autosave.js';
import { blurPublishFlowName, commitItemDetailDesc, commitItemDetailTitle, confirmPublishFlow, deleteDetailDraft, focusPublishFlowName, onItemDetailFieldChange, startPublishFlow, unpublishDetailItem, updateDetailItem } from './library-publish.js';
import { broadcastEditingState, closeConvo, closeSharedCanvasView, sendMsg, setTitleLevel } from './live-presence.js';
import { addItemToCustomFolderById, closeMarketDetail, deployPurchasedTemplate, handleLibrarySearch, handleMarketplaceSearch, purchaseCurrentMarketItem, removeFromCustomFolder, switchCartTab, switchLibraryFolder } from './marketplace.js';
import { clearMedia, setMediaFromLink, triggerMediaUpload } from './media-pdf-epub.js';
import { scheduleAgendaShift } from './messages-schedule.js';
import { handleHubCollabSearch, handleWaypointsSearch, openChatsPanel, openHubCollabPanel, openWaypointsPanel } from './panels-hamburger.js';
import { closeDotbotUpgradeModal, closePricingOverlay, openPricingOverlay } from './profile-achievements-pricing.js';
import { setTableAlign } from './resize-shortcuts-init.js';
import { openCellAddMenu } from './source-buttons-cursor-mode.js';
import { addTableCol, addTableRow, handleColNameKeydown, handleTableKeydown, renameTableColumn, setLastFocusedCell, startCellAudioRecording, stopCellAudioRecording, triggerCellAudioUpload, triggerCellImageUpload, updateTableCell } from './source-table.js';
import { closeCellTagPicker, closeTagContextMenu, commitTagRename, createTagFromCellPicker, deleteActiveTag, handleTagRenameKeydown, openTagContextMenu, startRenameActiveTag, toggleCellTag, triggerSourceUpload } from './source-tags-ai.js';
import { clearSearchCardContext, closeSearchCardsModal, filterShelfRows, handleShelfSourceRowClick, openSearchCardsModal, runNotificationAction, setFilterMode, shelfSelectSession, startRenameShelfName, startRenameShelfSourceRow, swTogglePause, swToggleRun, toggleFilterTag } from './stopwatch-search-notifications.js';

window.addGameColumnSlot = addGameColumnSlot;
window.addItemToCustomFolderById = addItemToCustomFolderById;
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
window.handleAddMenuSearchInput = handleAddMenuSearchInput;
window.handleCollabSearch = handleCollabSearch;
window.handleColNameKeydown = handleColNameKeydown;
window.handleHubCollabSearch = handleHubCollabSearch;
window.handleLibrarySearch = handleLibrarySearch;
window.handleMarketplaceSearch = handleMarketplaceSearch;
window.handleMsgSearch = handleMsgSearch;
window.handleSearchFocus = handleSearchFocus;
window.handleSearchInput = handleSearchInput;
window.handleShelfSourceRowClick = handleShelfSourceRowClick;
window.handleTableKeydown = handleTableKeydown;
window.handleTagRenameKeydown = handleTagRenameKeydown;
window.handleWaypointsSearch = handleWaypointsSearch;
window.hideCanvasContextMenu = hideCanvasContextMenu;
window.highlightContextColumn = highlightContextColumn;
window.highlightContextRow = highlightContextRow;
window.hmenuAction = hmenuAction;
window.newSourceClicked = newSourceClicked;
window.onItemDetailFieldChange = onItemDetailFieldChange;
window.openCellAddMenu = openCellAddMenu;
window.openChatsPanel = openChatsPanel;
window.openCollabPanel = openCollabPanel;
window.openHubCollabPanel = openHubCollabPanel;
window.openPricingOverlay = openPricingOverlay;
window.openSearchCardsModal = openSearchCardsModal;
window.openTableCellContextMenu = openTableCellContextMenu;
window.openTagContextMenu = openTagContextMenu;
window.openWaypointsPanel = openWaypointsPanel;
window.prepareAdd = prepareAdd;
window.purchaseCurrentMarketItem = purchaseCurrentMarketItem;
window.redo = redo;
window.removeFromCustomFolder = removeFromCustomFolder;
window.removeGameColumnSlot = removeGameColumnSlot;
window.removeTask = removeTask;
window.renameTableColumn = renameTableColumn;
window.runNotificationAction = runNotificationAction;
window.scheduleAgendaShift = scheduleAgendaShift;
window.sendMsg = sendMsg;
window.setFilterMode = setFilterMode;
window.setGameColumnSlot = setGameColumnSlot;
window.setLastFocusedCell = setLastFocusedCell;
window.setMediaFromLink = setMediaFromLink;
window.setTableAlign = setTableAlign;
window.setTitleLevel = setTitleLevel;
window.shelfSelectSession = shelfSelectSession;
window.startCellAudioRecording = startCellAudioRecording;
window.startPublishFlow = startPublishFlow;
window.startRenameActiveTag = startRenameActiveTag;
window.startRenameShelfName = startRenameShelfName;
window.startRenameShelfSourceRow = startRenameShelfSourceRow;
window.stopCellAudioRecording = stopCellAudioRecording;
window.swTogglePause = swTogglePause;
window.swToggleRun = swToggleRun;
window.switchAddTab = switchAddTab;
window.switchCartTab = switchCartTab;
window.switchLibraryFolder = switchLibraryFolder;
window.toggleAddMenuSearch = toggleAddMenuSearch;
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
