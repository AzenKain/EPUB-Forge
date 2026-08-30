import { create } from "zustand";
import {
  emptyMetadata,
  type BookAnalysis,
  type BookMetadata,
  type EpubFile,
  type ExportRange,
  type ExportedFile
} from "./types";

type Setter<T> = (value: T | ((current: T) => T)) => void;

type ExportProgress = {
  index: number;
  total: number;
  label: string;
};

function resolveValue<T>(value: T | ((current: T) => T), current: T): T {
  return typeof value === "function" ? (value as (current: T) => T)(current) : value;
}

type AppStore = {
  books: EpubFile[];
  folders: string[];
  selectedId: string;
  analysis: BookAnalysis | null;
  mergeOpen: boolean;
  importOpen: boolean;
  metadata: BookMetadata;
  metadataDirty: boolean;
  ranges: ExportRange[];
  previewIndex: number;
  includeFrontmatter: boolean;
  exports: ExportedFile[];
  busy: string;
  error: string;
  notice: string;
  sidebarCollapsed: boolean;
  volumesCollapsed: boolean;
  metadataOpen: boolean;
  fontOpen: boolean;
  exportProgress: ExportProgress | null;
  previewRevision: number;
  setBooks: Setter<EpubFile[]>;
  setFolders: Setter<string[]>;
  setSelectedId: Setter<string>;
  setAnalysis: Setter<BookAnalysis | null>;
  setMergeOpen: Setter<boolean>;
  setImportOpen: Setter<boolean>;
  setMetadata: Setter<BookMetadata>;
  updateMetadata: (patch: Partial<BookMetadata>) => void;
  setMetadataDirty: Setter<boolean>;
  setRanges: Setter<ExportRange[]>;
  setPreviewIndex: Setter<number>;
  setIncludeFrontmatter: Setter<boolean>;
  setExports: Setter<ExportedFile[]>;
  setBusy: Setter<string>;
  setError: Setter<string>;
  setNotice: Setter<string>;
  setSidebarCollapsed: Setter<boolean>;
  setVolumesCollapsed: Setter<boolean>;
  setMetadataOpen: Setter<boolean>;
  setFontOpen: Setter<boolean>;
  setExportProgress: Setter<ExportProgress | null>;
  setPreviewRevision: Setter<number>;
};

export const useAppStore = create<AppStore>((set) => ({
  books: [],
  folders: [],
  selectedId: "",
  analysis: null,
  mergeOpen: false,
  importOpen: false,
  metadata: emptyMetadata,
  metadataDirty: false,
  ranges: [],
  previewIndex: 0,
  includeFrontmatter: true,
  exports: [],
  busy: "",
  error: "",
  notice: "",
  sidebarCollapsed: false,
  volumesCollapsed: false,
  metadataOpen: false,
  fontOpen: false,
  exportProgress: null,
  previewRevision: 0,
  setBooks: (value) => set((state) => ({ books: resolveValue(value, state.books) })),
  setFolders: (value) => set((state) => ({ folders: resolveValue(value, state.folders) })),
  setSelectedId: (value) => set((state) => ({ selectedId: resolveValue(value, state.selectedId) })),
  setAnalysis: (value) => set((state) => ({ analysis: resolveValue(value, state.analysis) })),
  setMergeOpen: (value) => set((state) => ({ mergeOpen: resolveValue(value, state.mergeOpen) })),
  setImportOpen: (value) => set((state) => ({ importOpen: resolveValue(value, state.importOpen) })),
  setMetadata: (value) => set((state) => ({ metadata: resolveValue(value, state.metadata) })),
  updateMetadata: (patch) =>
    set((state) => ({
      metadata: { ...state.metadata, ...patch },
      metadataDirty: true
    })),
  setMetadataDirty: (value) => set((state) => ({ metadataDirty: resolveValue(value, state.metadataDirty) })),
  setRanges: (value) => set((state) => ({ ranges: resolveValue(value, state.ranges) })),
  setPreviewIndex: (value) => set((state) => ({ previewIndex: resolveValue(value, state.previewIndex) })),
  setIncludeFrontmatter: (value) =>
    set((state) => ({ includeFrontmatter: resolveValue(value, state.includeFrontmatter) })),
  setExports: (value) => set((state) => ({ exports: resolveValue(value, state.exports) })),
  setBusy: (value) => set((state) => ({ busy: resolveValue(value, state.busy) })),
  setError: (value) => set((state) => ({ error: resolveValue(value, state.error) })),
  setNotice: (value) => set((state) => ({ notice: resolveValue(value, state.notice) })),
  setSidebarCollapsed: (value) =>
    set((state) => ({ sidebarCollapsed: resolveValue(value, state.sidebarCollapsed) })),
  setVolumesCollapsed: (value) =>
    set((state) => ({ volumesCollapsed: resolveValue(value, state.volumesCollapsed) })),
  setMetadataOpen: (value) => set((state) => ({ metadataOpen: resolveValue(value, state.metadataOpen) })),
  setFontOpen: (value) => set((state) => ({ fontOpen: resolveValue(value, state.fontOpen) })),
  setExportProgress: (value) =>
    set((state) => ({ exportProgress: resolveValue(value, state.exportProgress) })),
  setPreviewRevision: (value) =>
    set((state) => ({ previewRevision: resolveValue(value, state.previewRevision) }))
}));
