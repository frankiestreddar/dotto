// Phase 4.4 port of public/dotto/marketplace.js: the template marketplace (Discover browsing,
// purchase flow, packaging a canvas selection into a draft). Reaches every still-vanilla
// dependency through window bridges — most already existed
// (window.__saveSnapshot/__render/__renderSelectedOutlines/__findItemById/__openItemDetail/
// __refreshBlocksPanel/__dottoSupabase), 6 are new as part of this port (__getAddMenuEl/
// __getBtnAddEl, __wireRailIcon/__openRailView, __snapshotItem/__sanitizeFlashcardSnapshot).
// "Browse your own library content" (drafts/published/purchased/custom folders) already moved to
// the Blocks panel (app/dotto/lib/blocksPanel.ts, ported since — was blocks-panel.js) when Library
// was repurposed into Plugins — this file is Discover/purchase-flow only, untouched by that move.

interface Item {
  id: number;
  kind: string;
  [key: string]: unknown;
}

interface FolderObj {
  items: Item[];
}

interface MarketplaceItem {
  id: string;
  title: string;
  description: string;
  tagline: string;
  price?: string;
  count: number;
  nodes: unknown[];
  canvasSnapshot: unknown[];
  creatorUsername?: string;
  acquiredAt?: string;
  [key: string]: unknown;
}

interface AppState {
  currentUser: { id: string | null };
  selectedMarketItem: MarketplaceItem | null;
  trendingMarketplace: MarketplaceItem[];
  userLibrary: {
    drafts: MarketplaceItem[];
    published: MarketplaceItem[];
    purchased: MarketplaceItem[];
  };
  marketplaceSearchQuery: string;
  selectedCardIds: number[];
  folders: Record<string, FolderObj>;
  currentFolderId: string;
  idCounter: number;
  tx: number;
  ty: number;
  btnCart?: HTMLElement;
  cartPanel?: HTMLElement;
}

function getAppState(): AppState | undefined {
  return window.__getAppState?.() as unknown as AppState | undefined;
}

interface MarketplaceRow {
  id: string;
  title: string;
  description?: string;
  tagline?: string;
  price_label?: string;
  content?: unknown[];
  status?: string;
  creator?: { username?: string };
}

// Restores the browse view, clearing any transient detail drill-down. Nothing is ever lost by
// calling this — a listing you're browsing is read-only until purchased/published elsewhere.
function resetMarketplacePanelView(): void {
  document.getElementById("market-detail-view")?.classList.remove("active");
  document.getElementById("view-discover")?.classList.add("active");
}

// Marketplace shares the permanent rail's one shell/pinned-state (see openRailView/wireRailIcon,
// app/dotto/lib/panelsHamburger.ts) — no separate positionCartPanel or its own click/hover/pin wiring
// (wireRailIcon covers that generically). This onOpen callback fires every time the Marketplace
// icon is clicked.
async function refreshCartPanel(): Promise<void> {
  const appState = getAppState();
  if (!appState) return;
  appState.selectedMarketItem = null;
  resetMarketplacePanelView();
  await refreshMarketplaceListings();
  renderMarketplaceDiscover();
}

// Opens the Blocks panel (rail-pinned) and refreshes it — used after a purchase so the newly-
// bought item shows up in its always-visible Purchased folder. Blocks shows every folder's
// contents at once, so there's no specific folder to navigate to, just a refresh.
function openBlocksAfterPurchase(): void {
  const addMenu = window.__getAddMenuEl?.();
  const btnAdd = window.__getBtnAddEl?.();
  if (!addMenu || !btnAdd) return;
  window.__openRailView?.("add", addMenu, btnAdd, () => window.__refreshBlocksPanel?.(), true);
}

// Listings are cached in trendingMarketplace / userLibrary.{purchased,drafts,published} (same
// shape and variable names the render functions below already expect) and refreshed from
// Supabase whenever the relevant tab opens. userLibrary.customFolders stays local/session-only —
// organizing a library into custom folders isn't backed by a table yet.
function marketplaceItemFromRow(row: MarketplaceRow): MarketplaceItem {
  const content = row.content || [];
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    tagline: row.tagline || "",
    price: row.price_label,
    count: content.length,
    nodes: content,
    canvasSnapshot: content,
  };
}

async function refreshMarketplaceListings(): Promise<void> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  if (!supabase || !appState) return;
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select(
      "id, title, description, tagline, price_label, content, creator:profiles!marketplace_listings_creator_id_fkey(username)",
    )
    .eq("status", "published")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[marketplace] failed to load listings:", error);
    return;
  }
  appState.trendingMarketplace = ((data as unknown as MarketplaceRow[]) || []).map((row) => ({
    ...marketplaceItemFromRow(row),
    creatorUsername: row.creator?.username || "Unknown",
  }));
}

// Populates userLibrary.{drafts,published,purchased} from Supabase — called by refreshBlocksPanel
// (app/dotto/lib/blocksPanel.ts) every time the Blocks panel opens.
export async function refreshMyLibrary(): Promise<void> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  if (!supabase || !appState?.currentUser.id) return;
  const { data: mine, error: mineErr } = await supabase
    .from("marketplace_listings")
    .select("id, title, description, tagline, price_label, status, content")
    .eq("creator_id", appState.currentUser.id)
    .order("created_at", { ascending: false });
  if (mineErr) console.error("[marketplace] failed to load my listings:", mineErr);
  const mineRows = (mine as unknown as MarketplaceRow[]) || [];
  appState.userLibrary.drafts = mineRows
    .filter((r) => r.status === "draft")
    .map(marketplaceItemFromRow);
  appState.userLibrary.published = mineRows
    .filter((r) => r.status === "published")
    .map(marketplaceItemFromRow);

  const { data: acquired, error: acqErr } = await supabase
    .from("library_items")
    .select(
      "acquired_at, listing:marketplace_listings(id, title, description, tagline, price_label, content)",
    )
    .eq("user_id", appState.currentUser.id)
    .order("acquired_at", { ascending: false });
  if (acqErr) console.error("[marketplace] failed to load purchased items:", acqErr);
  // acquired_at drives the Blocks panel's Purchased folder, sorted most-recent-first — carried
  // through as acquiredAt alongside the usual marketplaceItemFromRow shape.
  appState.userLibrary.purchased = (
    (acquired as unknown as { acquired_at: string; listing: MarketplaceRow | null }[]) || []
  )
    .filter((r) => r.listing)
    .map((r) => ({
      ...marketplaceItemFromRow(r.listing as MarketplaceRow),
      acquiredAt: r.acquired_at,
    }));
}

export function handleMarketplaceSearch(val: string): void {
  const appState = getAppState();
  if (!appState) return;
  appState.marketplaceSearchQuery = val.trim().toLowerCase();
  renderMarketplaceDiscover();
}

// Real React state (see app/dotto/MarketDiscoverPanel.jsx, marketDiscoverStore) — genuine JSX
// rows, same reasoning as WaypointsListPanel (simple title/price/desc/meta, no per-row widget
// state). openMarketDetail/the rest of the marketplace/library cluster stay in this pattern for
// now — this is one self-contained slice of a much bigger file, converted incrementally.
function renderMarketplaceDiscover(): void {
  const appState = getAppState();
  if (!appState) return;
  const q = appState.marketplaceSearchQuery;
  const filtered = appState.trendingMarketplace.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      (item.tagline || "").toLowerCase().includes(q),
  );
  window.__setMarketDiscover?.(filtered);
}

// #market-detail-content's content is real React state (see app/dotto/MarketDetailPanel.jsx,
// marketDetailStore) — text fields as real JSX, the canvas preview mounted via a ref. Which VIEW
// is showing (#view-discover vs #market-detail-view) stays a plain classList toggle — shared
// machinery with resetMarketplacePanelView/openItemDetail/startPublishFlow elsewhere in this
// cluster, not something to partially hand to React without converting all of them together.
export function openMarketDetail(item: MarketplaceItem): void {
  const appState = getAppState();
  if (!appState) return;
  appState.selectedMarketItem = item;
  document.getElementById("view-discover")?.classList.remove("active");
  document.getElementById("market-detail-view")?.classList.add("active");
  window.__setMarketDetail?.(item);
}

export function closeMarketDetail(): void {
  const appState = getAppState();
  if (!appState) return;
  appState.selectedMarketItem = null;
  document.getElementById("market-detail-view")?.classList.remove("active");
  document.getElementById("view-discover")?.classList.add("active");
  window.__setMarketDetail?.(null);
}

export async function purchaseCurrentMarketItem(): Promise<void> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  if (!appState?.selectedMarketItem) return;

  const alreadyOwns = appState.userLibrary.purchased.some(
    (x) => x.id === appState.selectedMarketItem?.id,
  );
  if (alreadyOwns) {
    alert("This template snapshot is already inside your Library!");
    closeMarketDetail();
    openBlocksAfterPurchase();
    return;
  }

  const { error } =
    (await supabase
      ?.from("library_items")
      .insert({ user_id: appState.currentUser.id, listing_id: appState.selectedMarketItem.id })) ||
    {};
  if (error) {
    console.error("[marketplace] purchase failed:", error);
    alert("Something went wrong adding this to your library.");
    return;
  }

  alert(
    `Successfully purchased "${appState.selectedMarketItem.title}" as a customizable template snapshot!`,
  );
  closeMarketDetail();
  openBlocksAfterPurchase();
}

export function deployPurchasedTemplate(id: string): void {
  const appState = getAppState();
  const item = appState?.userLibrary.purchased.find((x) => x.id === id);
  if (!appState || !item) return;

  window.__saveSnapshot?.();
  const startX = Math.round((appState.tx + 200) / 28) * 28;
  const startY = Math.round((appState.ty + 200) / 28) * 28;

  // Spawn cards on canvas
  appState.folders[appState.currentFolderId].items.push({
    id: appState.idCounter++,
    x: startX,
    y: startY,
    w: 224,
    h: 112,
    kind: "note",
    html: `<strong>${item.title} Note Block</strong><br>Newly deployed blueprint package.`,
  });

  window.__render?.();
  window.__closeRailView?.();
}

export function packageSelectedAsTemplate(targetIt: Item): void {
  const appState = getAppState();
  if (!appState) return;
  const itemsToPackage: unknown[] = [];
  // If targetIt is selected, package all selected cards. Otherwise, package just this single card.
  const gestureIds = appState.selectedCardIds.includes(targetIt.id)
    ? appState.selectedCardIds.slice()
    : [targetIt.id];
  gestureIds.forEach((id) => {
    const it = window.__findItemById?.(id);
    if (it)
      itemsToPackage.push(
        window.__sanitizeFlashcardSnapshot?.(window.__snapshotItem?.(it), gestureIds),
      );
  });

  if (itemsToPackage.length === 0) return;

  createDraftFromItems(itemsToPackage);

  // Clear selection to avoid visual clutter
  appState.selectedCardIds = [];
  window.__renderSelectedOutlines?.();
}

// Cards dropped onto the Blocks panel's dropzone are saved as a draft row right away (rather than
// held only in local state), so there's nothing left to lose if the panel gets closed (e.g.
// clicking outside it) before the user is done editing it.
async function createDraftFromItems(items: unknown[]): Promise<void> {
  const appState = getAppState();
  const supabase = window.__dottoSupabase;
  if (!supabase || !appState?.currentUser.id) return;
  const { data, error } = await supabase
    .from("marketplace_listings")
    .insert({
      creator_id: appState.currentUser.id,
      title: "Untitled Draft",
      description: "",
      tagline: "",
      content: items,
      status: "draft",
    })
    .select("id, title, description, tagline, price_label, status, content")
    .single();
  if (error) {
    console.error("[marketplace] failed to create draft:", error);
    return;
  }

  const newItem = marketplaceItemFromRow(data as unknown as MarketplaceRow);
  appState.userLibrary.drafts.unshift(newItem);

  // packageSelectedAsTemplate (which called this) only ever fires while a card is dropped onto
  // the Blocks panel, which is therefore already open — just open the new draft, no need to open
  // the panel itself.
  window.__openItemDetail?.(newItem, "drafts");
}

// Wires the Marketplace rail icon's click/hover/pin behavior — was a plain module-load-time
// wireRailIcon(...) call in the original vanilla file. Needs appState.btnCart/appState.cartPanel
// (real DOM elements, populated once app/dotto/lib/coreState.ts's own init runs) available RIGHT at wire time,
// same bridge-readiness poll wireCopyPaste/wireDayChangeAndAdNotifications already established —
// window.__wireRailIcon itself might not exist yet when DottoApp's own mount effect runs.
const BRIDGE_WAIT_TIMEOUT_MS = 30000;
const BRIDGE_POLL_INTERVAL_MS = 100;

function doWire(appState: AppState): void {
  if (!appState.btnCart || !appState.cartPanel) return;
  window.__wireRailIcon?.("marketplace", appState.btnCart, appState.cartPanel, refreshCartPanel);
}

export function wireMarketplace(): () => void {
  const ready = () => window.__wireRailIcon && getAppState()?.btnCart && getAppState()?.cartPanel;
  const appStateNow = getAppState();
  if (ready() && appStateNow) {
    doWire(appStateNow);
    return () => {};
  }

  let cancelled = false;
  const start = Date.now();
  const poll = setInterval(() => {
    if (cancelled) return;
    const appState = getAppState();
    if (ready() && appState) {
      clearInterval(poll);
      doWire(appState);
      return;
    }
    if (Date.now() - start > BRIDGE_WAIT_TIMEOUT_MS) clearInterval(poll); // give up quietly — see this function's own comment
  }, BRIDGE_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(poll);
  };
}

// React → vanilla bridges — used by MarketDiscoverPanel.jsx/ItemDetailFooter.jsx (app/dotto/),
// which can't import this directly since public/dotto/*.js isn't reachable from app/dotto/.
// Guarded: this module's top level is reached during Next's server-side render pass (a
// pre-existing, project-wide issue across every Phase 4.4/4.5 bridge file, discovered and
// documented while finishing the history-autosave.js port — see PHASE4_ROADMAP.md), where
// `window` genuinely does not exist yet.
if (typeof window !== "undefined") {
  window.__openMarketDetail = openMarketDetail;
  window.__deployPurchasedTemplate = deployPurchasedTemplate;
  window.__packageSelectedAsTemplate = packageSelectedAsTemplate;
  // Not inline-HTML onclick targets anymore (see window-bridge.js's own header comment for why
  // those live there instead) — window.deployPurchasedTemplate (no `__` prefix) was a genuinely
  // dead vestigial assignment in window-bridge.js before this port (no inline HTML ever called it,
  // only window.__deployPurchasedTemplate above, from ItemDetailFooter.jsx), dropped here rather
  // than recreated. These 3 ARE still real inline onclick targets (hamburger-stack.html), so they
  // keep the plain (non-`__`) global name window-bridge.js used to set.
  window.handleMarketplaceSearch = handleMarketplaceSearch;
  window.closeMarketDetail = closeMarketDetail;
  window.purchaseCurrentMarketItem = purchaseCurrentMarketItem;
  // Vanilla → React bridge — blocks-panel.js/library-publish.js both previously imported this
  // directly; public/dotto/*.js can't import from app/dotto/.
  window.__refreshMyLibrary = refreshMyLibrary;
}
