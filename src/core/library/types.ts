// [SPEC-4] Track library contracts. A track is a self-contained coded loop
// ([SPEC-4.5]); its category comes from its folder ([PLAN D] "Dossier =
// catégorie"), so it is not repeated inside the file — single source of truth.

/** Supported loop lengths in beats. Extensible by design. [SPEC-4.2] */
export type Beats = 4 | 8 | 16 | 32 | 64 | number;

/** What a `*.track.yaml` file declares, once parsed and validated. [SPEC-4.2/4.6, PLAN C.1] */
export interface TrackDefinition {
  /** Display name, unique within its category. */
  name: string;
  /** Loop length in beats (declared metadata, not encoded in the filename). */
  beats: Beats;
  /** The loop itself, as Strudel code. [SPEC-3.1] */
  pattern: string;
  /** Optional search/filter tags. */
  tags?: string[];
  /** Optional base relative level. [PLAN C.1] */
  gain?: number;
  /** Optional reference key (Camelot code, e.g. "1A"). Present ⇒ the track is
   *  pitched and gets transposed to the selected key; absent ⇒ never transposed
   *  (drums). [SPEC-17.19] */
  key?: string;
}

/** A manifest entry: metadata + identity, no behavior. [SPEC-4.3, PLAN C.2] */
export interface TrackManifestEntry {
  /** Stable id: `category/slug`. */
  id: string;
  category: string;
  /** Filename slug (without the `.track.yaml` suffix). */
  slug: string;
  name: string;
  beats: Beats;
  tags: string[];
  gain?: number;
  /** Reference key (Camelot code) if the track is pitched. [SPEC-17.19] */
  key?: string;
  /** Source path, for reference/debug. */
  path: string;
}

/** A fully loaded track: manifest metadata + its pattern code. */
export interface LoadedTrack extends TrackManifestEntry {
  pattern: string;
}

/** A file that failed to load or validate — surfaced to the user, never hidden. [SPEC-14.3] */
export interface TrackLoadError {
  path: string;
  message: string;
}

export interface LibraryIndex {
  tracks: LoadedTrack[];
  errors: TrackLoadError[];
}
