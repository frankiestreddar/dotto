// Phase 4.5 port of public/dotto/library-publish.js: the Blocks panel's Item Detail view
// (Purchased / My Creations = drafts+published) and the Publish Flow (draft -> published). Was
// Library's item detail view — relocated into #add-menu (content/fragments/hamburger-stack.html)
// along with the rest of "browse your own library content" when Library was repurposed into
// Plugins. refreshBlocksPanel (app/dotto/lib/blocksPanel.ts, ported since — was blocks-panel.js)
// is reached via window.__refreshBlocksPanel rather than a direct import — blocksPanel.ts itself
// calls openItemDetail/deleteMyCreationItem via the __openItemDetail/__deleteMyCreationItem
// bridges below, a direct import back would be circular (kept as bridges in both directions
// deliberately, even after blocks-panel.js itself left the vanilla tree, rather than newly
// co-locating and resolving it — see blocksPanel.ts's own header comment).
// ItemDetailTitle.jsx/PublishFlowName.jsx/
// ItemDetailFooter.jsx (same app/dotto/ tree) now import their functions directly instead of going
// through window bridges.

import { useItemDetailFooterStore } from "./itemDetailFooterStore";

interface MarketplaceItem {
  id: string;
  title: string;
  description: string;
  price?: string;
  nodes?: Record<string, unknown>[];
  canvasSnapshot?: Record<string, unknown>[];
  [key: string]: unknown;
}

interface AppState {
  detailItem: MarketplaceItem | null;
  detailSourceFolder: string | null;
  detailOriginal: { title: string; description: string; price: string } | null;
  publishFlowItem: MarketplaceItem | null;
  panelPinned: { rail: boolean; [key: string]: unknown };
  userLibrary: {
    drafts: MarketplaceItem[];
    published: MarketplaceItem[];
    purchased: MarketplaceItem[];
  };
}

function getAppState(): AppState {
  return window.__getAppState!() as unknown as AppState;
}

// ---------- Blocks panel: Item Detail View (Purchased / My Creations = drafts+published) ----------
export function openItemDetail(item: MarketplaceItem, sourceFolder: string): void {
  const appState = getAppState();
  appState.detailItem = item;
  appState.detailSourceFolder = sourceFolder;
  appState.detailOriginal = {
    title: item.title,
    description: item.description || "",
    price: item.price || "",
  };

  // Keep the Blocks panel open (pinned) while the detail page is showing — it shares the one
  // rail-wide pinned flag now (see appState.panelPinned.rail, app/dotto/lib/coreState.ts). Both
  // callers (a Blocks row click, or packageSelectedAsTemplate's drag-drop) only ever reach this
  // while the Blocks panel is already the open rail view, so this is just making that state
  // explicit rather than actually switching panels.
  appState.panelPinned.rail = true;
  window.__getAddMenuEl?.()?.classList.add("open");
  window.__getBtnAddEl?.()?.classList.add("active");

  document.getElementById("view-library")?.classList.remove("active");
  document.getElementById("publish-flow-view")?.classList.remove("active");
  document.getElementById("item-detail-view")?.classList.add("active");

  const view = document.getElementById("item-detail-view");
  view?.classList.toggle("status-draft", sourceFolder === "drafts");
  view?.classList.toggle("status-published", sourceFolder === "published");
  view?.classList.toggle("status-purchased", sourceFolder === "purchased");

  const isOwner = sourceFolder !== "purchased";

  const titleEl = document.getElementById("item-detail-title") as HTMLElement;
  titleEl.textContent = item.title || "";
  titleEl.contentEditable = isOwner ? "true" : "false";

  const priceEl = document.getElementById("item-detail-price") as HTMLInputElement;
  priceEl.value = item.price || "";
  priceEl.disabled = !isOwner;

  const descEl = document.getElementById("item-detail-desc") as HTMLTextAreaElement;
  descEl.value = item.description || "";
  descEl.disabled = !isOwner;
  descEl.placeholder = isOwner ? "Add a description..." : "";

  const canvasWrap = document.getElementById("item-detail-canvas-wrap") as HTMLElement;
  canvasWrap.innerHTML = "";
  canvasWrap.appendChild(
    window.__renderInlineCanvas!(item.nodes || item.canvasSnapshot || [], false),
  );

  renderItemDetailFooter();
}

// Real React state now (see app/dotto/ItemDetailFooter.jsx, useItemDetailFooterStore) — a
// natural, self-contained discriminated union, unlike the rest of this view (see
// app/dotto/lib/itemDetailFooterStore.ts's own comment for why the form fields stay vanilla).
function renderItemDetailFooter(): void {
  const appState = getAppState();
  useItemDetailFooterStore.setState({
    sourceFolder: appState.detailSourceFolder,
    itemId: appState.detailItem!.id,
    dirty: appState.detailSourceFolder === "published" ? isDetailDirty() : false,
  });
}

function isDetailDirty(): boolean {
  const appState = getAppState();
  if (!appState.detailOriginal) return false;
  const title = (document.getElementById("item-detail-title")?.textContent || "").trim();
  const description = (
    document.getElementById("item-detail-desc") as HTMLTextAreaElement
  ).value.trim();
  const price = (document.getElementById("item-detail-price") as HTMLInputElement).value.trim();
  return (
    title !== appState.detailOriginal.title ||
    description !== appState.detailOriginal.description ||
    price !== appState.detailOriginal.price
  );
}

export function onItemDetailFieldChange(): void {
  const appState = getAppState();
  if (appState.detailSourceFolder !== "published") return;
  renderItemDetailFooter();
}

// Drafts are private and low-stakes, so title/description edits autosave on blur rather than
// needing an explicit save action (there's no "Save" button anymore).
export function commitItemDetailTitle(): void {
  const appState = getAppState();
  if (appState.detailSourceFolder !== "drafts" || !appState.detailItem) return;
  const titleEl = document.getElementById("item-detail-title") as HTMLElement;
  const title = (titleEl.textContent || "").trim() || "Untitled Draft";
  titleEl.textContent = title;
  if (title === appState.detailItem.title) return;
  appState.detailItem.title = title;
  appState.detailOriginal!.title = title;
  window.__dottoSupabase
    ?.from("marketplace_listings")
    .update({ title })
    .eq("id", appState.detailItem.id)
    .then(({ error }: { error: unknown }) => {
      if (error) console.error("[marketplace] failed to save title:", error);
    });
  const cached = appState.userLibrary.drafts.find((x) => x.id === appState.detailItem!.id);
  if (cached) cached.title = title;
}

// Currently unreached — the description field's inline oninput only fires
// onItemDetailFieldChange, no blur-commit ever calls this (pre-existing, carried over unchanged
// from the vanilla file, not a regression introduced by this port).
export function commitItemDetailDesc(): void {
  const appState = getAppState();
  if (appState.detailSourceFolder !== "drafts" || !appState.detailItem) return;
  const description = (document.getElementById("item-detail-desc") as HTMLTextAreaElement).value;
  if (description === appState.detailItem.description) return;
  appState.detailItem.description = description;
  appState.detailOriginal!.description = description;
  window.__dottoSupabase
    ?.from("marketplace_listings")
    .update({ description })
    .eq("id", appState.detailItem.id)
    .then(({ error }: { error: unknown }) => {
      if (error) console.error("[marketplace] failed to save description:", error);
    });
  const cached = appState.userLibrary.drafts.find((x) => x.id === appState.detailItem!.id);
  if (cached) cached.description = description;
}

// Published listings are live/public, so edits here are staged locally and only pushed once
// "Update" is explicitly clicked (that's what the disabled-until-dirty state guards).
export async function updateDetailItem(): Promise<void> {
  const appState = getAppState();
  if (!appState.detailItem || appState.detailSourceFolder !== "published") return;
  const title =
    (document.getElementById("item-detail-title")?.textContent || "").trim() ||
    appState.detailItem.title;
  const description = (
    document.getElementById("item-detail-desc") as HTMLTextAreaElement
  ).value.trim();
  const price =
    (document.getElementById("item-detail-price") as HTMLInputElement).value.trim() ||
    appState.detailItem.price;

  const { error } = await window
    .__dottoSupabase!.from("marketplace_listings")
    .update({ title, description, price_label: price })
    .eq("id", appState.detailItem.id);
  if (error) {
    console.error("[marketplace] failed to update listing:", error);
    return;
  }

  appState.detailItem.title = title;
  appState.detailItem.description = description;
  appState.detailItem.price = price;
  appState.detailOriginal = { title, description, price: price || "" };
  document.getElementById("item-detail-title")!.textContent = title;
  const cached = appState.userLibrary.published.find((x) => x.id === appState.detailItem!.id);
  if (cached) {
    cached.title = title;
    cached.description = description;
    cached.price = price;
  }
  renderItemDetailFooter();
}

export async function unpublishDetailItem(): Promise<void> {
  const appState = getAppState();
  if (!appState.detailItem || appState.detailSourceFolder !== "published") return;
  const { error } = await window
    .__dottoSupabase!.from("marketplace_listings")
    .update({ status: "draft", published_at: null })
    .eq("id", appState.detailItem.id);
  if (error) {
    console.error("[marketplace] failed to unpublish:", error);
    return;
  }
  await window.__refreshMyLibrary?.();
  closeItemDetail();
  window.__refreshBlocksPanel?.();
}

// Core delete, shared by deleteDetailDraft (the detail view's own button, drafts only,
// ItemDetailFooter.jsx's existing gating) and deleteMyCreationItem (app/dotto/lib/blocksPanel.ts's
// row-level hover delete button, which can target either a draft OR a published item — My
// Creations is drafts+published combined).
async function deleteMarketplaceListing(
  id: string,
  folderKey: "drafts" | "published",
): Promise<boolean> {
  const appState = getAppState();
  const { error } = await window
    .__dottoSupabase!.from("marketplace_listings")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("[marketplace] failed to delete listing:", error);
    return false;
  }
  appState.userLibrary[folderKey] = appState.userLibrary[folderKey].filter((x) => x.id !== id);
  return true;
}

export async function deleteDetailDraft(): Promise<void> {
  const appState = getAppState();
  if (!appState.detailItem || appState.detailSourceFolder !== "drafts") return;
  const ok = await deleteMarketplaceListing(appState.detailItem.id, "drafts");
  if (!ok) return;
  closeItemDetail();
  window.__refreshBlocksPanel?.();
}

// Row-level delete (Blocks panel's hover delete button on a My Creations item, not gated on
// appState.detailItem/detailSourceFolder the way deleteDetailDraft is — this is called directly
// from a list row, no need to have clicked into the item detail view first). folderKey is
// 'drafts' or 'published', resolved by the caller via resolveItemStatus (app/dotto/lib/blocksPanel.ts).
export async function deleteMyCreationItem(
  item: MarketplaceItem,
  folderKey: "drafts" | "published",
): Promise<void> {
  const ok = await deleteMarketplaceListing(item.id, folderKey);
  if (ok) window.__refreshBlocksPanel?.();
}

function closeItemDetail(): void {
  const appState = getAppState();
  appState.detailItem = null;
  appState.detailSourceFolder = null;
  appState.detailOriginal = null;
  document.getElementById("item-detail-view")?.classList.remove("active");
  document.getElementById("view-library")?.classList.add("active");
  window.__refreshBlocksPanel?.();
}

// ---------- Publish Flow (draft -> published, no native alert()/prompt() popups) ----------

export function startPublishFlow(): void {
  const appState = getAppState();
  if (!appState.detailItem || appState.detailSourceFolder !== "drafts") return;
  appState.publishFlowItem = appState.detailItem;

  document.getElementById("item-detail-view")?.classList.remove("active");
  document.getElementById("publish-flow-view")?.classList.add("active");

  document.getElementById("publish-flow-name")!.textContent = appState.publishFlowItem.title || "";
  (document.getElementById("publish-flow-price") as HTMLInputElement).value = "";
  (document.getElementById("publish-flow-tagline") as HTMLInputElement).value = "";
  (document.getElementById("publish-flow-desc") as HTMLTextAreaElement).value =
    appState.publishFlowItem.description || "";

  const canvasWrap = document.getElementById("publish-flow-canvas-wrap") as HTMLElement;
  canvasWrap.innerHTML = "";
  canvasWrap.appendChild(window.__renderInlineCanvas!(appState.publishFlowItem.nodes || [], false));
}

// Clicking into the name field always jumps the caret (and visible scroll) to the end, so you can
// see what you're typing; blurring resets the scroll to the start, so the beginning of the name is
// what's visible while not editing.
export function focusPublishFlowName(): void {
  const el = document.getElementById("publish-flow-name") as HTMLElement;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  el.scrollLeft = el.scrollWidth;
}
export function blurPublishFlowName(): void {
  (document.getElementById("publish-flow-name") as HTMLElement).scrollLeft = 0;
}

export async function confirmPublishFlow(): Promise<void> {
  const appState = getAppState();
  if (!appState.publishFlowItem) return;
  const title =
    (document.getElementById("publish-flow-name")?.textContent || "").trim() ||
    appState.publishFlowItem.title ||
    "Untitled Draft";
  const price =
    (document.getElementById("publish-flow-price") as HTMLInputElement).value.trim() || "Free";
  const tagline = (
    document.getElementById("publish-flow-tagline") as HTMLInputElement
  ).value.trim();
  const description = (
    document.getElementById("publish-flow-desc") as HTMLTextAreaElement
  ).value.trim();

  const { error } = await window
    .__dottoSupabase!.from("marketplace_listings")
    .update({
      status: "published",
      title,
      price_label: price,
      tagline,
      description,
      published_at: new Date().toISOString(),
    })
    .eq("id", appState.publishFlowItem.id);
  if (error) {
    console.error("[marketplace] failed to publish:", error);
    return;
  }

  appState.publishFlowItem = null;
  document.getElementById("publish-flow-view")?.classList.remove("active");
  document.getElementById("view-library")?.classList.add("active");
  await window.__refreshMyLibrary?.();
  window.__refreshBlocksPanel?.();
}

// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  // __openItemDetail used by app/dotto/lib/marketplace.ts too; both bridges used by
  // app/dotto/lib/blocksPanel.ts (a different lib file, reached via a bridge rather than a direct
  // import specifically because blocksPanel.ts itself calls refreshBlocksPanel via this same
  // bridge convention — a direct import back would be circular; see blocksPanel.ts's own header
  // comment).
  window.__openItemDetail = openItemDetail;
  window.__deleteMyCreationItem = deleteMyCreationItem;
  // Plain (non-`__`) globals — real inline oninput/onclick targets in
  // content/fragments/hamburger-stack.html's price/description fields and Publish button, same
  // shape window.pushNotification uses.
  window.onItemDetailFieldChange = onItemDetailFieldChange;
  window.confirmPublishFlow = confirmPublishFlow;
}
