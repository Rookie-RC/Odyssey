"use client";

// Manage Atlas shell (PRODUCT_SPEC §26, VISUAL_SPEC §15): a full-screen local
// utility layer opened from the Profile drawer. It is deliberately more
// conventional than the public Atlas but uses the same theme tokens, type and
// Light/Night system. Sections: Overview, Places, Visits, Wishlist, Media,
// Settings. Import/Export is out of V1 scope.
import { useMemo, useState } from "react";
import type { Media, Place, Profile, Settings, Visit, Wishlist } from "../../lib/types";
import { HttpAtlasRepository, type AtlasRepository } from "../../lib/repository";
import type { RuntimeInfo } from "../../lib/api";
import type { AtlasTheme } from "../../themes";
import ManageOverview from "./ManageOverview";
import ManagePlaces from "./ManagePlaces";
import ManageVisits from "./ManageVisits";
import ManageWishlist from "./ManageWishlist";
import ManageMedia from "./ManageMedia";
import ManageSettings from "./ManageSettings";
import AddFlow, { type AddKind } from "./AddFlow";
import EntityEditor from "./EntityEditor";
import { Btn } from "./FormUI";

export type ManageSection = "overview" | "places" | "visits" | "wishlist" | "media" | "settings";

export interface ManageContext {
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  media: Media[];
  profile: Profile | null;
  settings: Settings | null;
  theme: AtlasTheme;
  runtime: RuntimeInfo | null;
  repo: AtlasRepository;
  notify: (msg: string) => void;
  reload: () => void;
  openAdd: (kind: AddKind) => void;
  openEditVisit: (id: string) => void;
  openEditWishlist: (id: string) => void;
  openEditPlace: (id: string) => void;
}

type EditorState =
  | { kind: "add"; addKind: AddKind }
  | { kind: "edit-visit"; id: string }
  | { kind: "edit-wishlist"; id: string }
  | { kind: "edit-place"; id: string }
  | null;

const SECTIONS: { id: ManageSection; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "places", label: "Places" },
  { id: "visits", label: "Visits" },
  { id: "wishlist", label: "Wishlist" },
  { id: "media", label: "Media" },
  { id: "settings", label: "Settings" },
];

interface ManageAtlasProps {
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  media: Media[];
  profile: Profile | null;
  settings: Settings | null;
  theme: AtlasTheme;
  runtime: RuntimeInfo | null;
  onReload: () => void;
  onExit: () => void;
  onToggleTheme: () => void;
}

export default function ManageAtlas({
  places,
  visits,
  wishlist,
  media,
  profile,
  settings,
  theme,
  runtime,
  onReload,
  onExit,
  onToggleTheme,
}: ManageAtlasProps) {
  const [section, setSection] = useState<ManageSection>("overview");
  const [editor, setEditor] = useState<EditorState>(null);
  const [toast, setToast] = useState("");

  const repo = useMemo(() => new HttpAtlasRepository(), []);

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3500);
  };

  const reload = () => {
    onReload();
  };

  const ctx: ManageContext = {
    places,
    visits,
    wishlist,
    media,
    profile,
    settings,
    theme,
    runtime,
    repo,
    notify,
    reload,
    openAdd: (addKind) => setEditor({ kind: "add", addKind }),
    openEditVisit: (id) => setEditor({ kind: "edit-visit", id }),
    openEditWishlist: (id) => setEditor({ kind: "edit-wishlist", id }),
    openEditPlace: (id) => setEditor({ kind: "edit-place", id }),
  };

  const editorTitle =
    editor?.kind === "add"
      ? editor.addKind === "visit"
        ? "I've been here"
        : "I want to go here"
      : editor?.kind === "edit-visit"
        ? "Edit visit"
        : editor?.kind === "edit-wishlist"
          ? "Edit wishlist"
          : editor?.kind === "edit-place"
            ? "Edit place"
            : "";

  return (
    <div className="atlas-manage">
      <header className="atlas-manage__topbar">
        <div className="atlas-manage__brand">
          <span className="atlas-manage__title">Manage Atlas</span>
          <span className="atlas-manage__datadir" title={runtime?.dataDir ?? ""}>
            {runtime?.dataDir ?? "…"}
          </span>
        </div>
        <div className="atlas-manage__topbar-actions">
          <Btn onClick={onToggleTheme}>{theme.id === "light" ? "Night" : "Light"}</Btn>
          <Btn kind="primary" onClick={onExit}>
            Back to Atlas
          </Btn>
        </div>
      </header>

      <div className="atlas-manage__body">
        <nav className="atlas-manage__nav" aria-label="Manage sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={"atlas-manage__nav-item" + (section === s.id ? " atlas-manage__nav-item--active" : "")}
              onClick={() => setSection(s.id)}
            >
              {s.label}
              {s.id === "places" && places.length > 0 ? (
                <span className="atlas-manage__count">{places.length}</span>
              ) : null}
              {s.id === "visits" && visits.length > 0 ? (
                <span className="atlas-manage__count">{visits.length}</span>
              ) : null}
              {s.id === "wishlist" && wishlist.length > 0 ? (
                <span className="atlas-manage__count">{wishlist.length}</span>
              ) : null}
              {s.id === "media" && media.length > 0 ? (
                <span className="atlas-manage__count">{media.length}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <main className="atlas-manage__content">
          {section === "overview" ? <ManageOverview ctx={ctx} /> : null}
          {section === "places" ? <ManagePlaces ctx={ctx} /> : null}
          {section === "visits" ? <ManageVisits ctx={ctx} /> : null}
          {section === "wishlist" ? <ManageWishlist ctx={ctx} /> : null}
          {section === "media" ? <ManageMedia ctx={ctx} /> : null}
          {section === "settings" ? <ManageSettings ctx={ctx} /> : null}
        </main>
      </div>

      {editor ? (
        <div className="atlas-manage__editor">
          <div className="atlas-manage__editor-sheet">
            <div className="atlas-manage__editor-title">{editorTitle}</div>
            {editor.kind === "add" ? (
              <AddFlow
                key={editor.addKind}
                kind={editor.addKind}
                places={places}
                media={media}
                theme={theme}
                repo={repo}
                onDone={(msg) => {
                  setEditor(null);
                  notify(msg);
                  reload();
                }}
                onCancel={() => setEditor(null)}
              />
            ) : null}
            {editor.kind === "edit-visit" ? (
              <EntityEditor
                kind="visit"
                id={editor.id}
                ctx={ctx}
                onDone={(msg) => {
                  setEditor(null);
                  notify(msg);
                  reload();
                }}
                onCancel={() => setEditor(null)}
              />
            ) : null}
            {editor.kind === "edit-wishlist" ? (
              <EntityEditor
                kind="wishlist"
                id={editor.id}
                ctx={ctx}
                onDone={(msg) => {
                  setEditor(null);
                  notify(msg);
                  reload();
                }}
                onCancel={() => setEditor(null)}
              />
            ) : null}
            {editor.kind === "edit-place" ? (
              <EntityEditor
                kind="place"
                id={editor.id}
                ctx={ctx}
                onDone={(msg) => {
                  setEditor(null);
                  notify(msg);
                  reload();
                }}
                onCancel={() => setEditor(null)}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="atlas-manage__toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
