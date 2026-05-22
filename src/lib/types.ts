export type EpubFile = {
  id: string;
  name: string;
  size: number;
};

export type Chapter = {
  index: number;
  idref: string;
  href: string;
  path: string;
  title: string;
  mediaType: string;
  linear: boolean;
};

export type DetectedVolume = {
  label: string;
  startIndex: number;
  endIndex: number;
  confidence: "high" | "medium";
  reason: string;
};

export type BookMetadata = {
  title: string;
  creator: string;
  language: string;
  publisher: string;
  description: string;
  subject: string;
  series?: string;
  seriesIndex?: string;
  coverImage?: string;
};

export type BookAnalysis = {
  id: string;
  fileName: string;
  title: string;
  creator: string;
  metadata: BookMetadata;
  size: number;
  spine: Chapter[];
  detectedVolumes: DetectedVolume[];
  coverPath: string;
  images: string[];
};

export type ExportRange = {
  label: string;
  startIndex: number;
  endIndex: number;
  coverImage?: string;
};

export type ExportedFile = {
  name: string;
  path: string;
  url: string;
  size: number;
};

export type ExportResponse = {
  files: ExportedFile[];
};

export const emptyMetadata: BookMetadata = {
  title: "",
  creator: "",
  language: "",
  publisher: "",
  description: "",
  subject: "",
  series: "",
  seriesIndex: "",
  coverImage: ""
};

export type GalleryImage = {
  fullPath: string;
  href: string;
  caption: string;
  selected: boolean;
  order: number;
};

export type GalleryResponse = {
  availableImages: GalleryImage[];
  selectedImages: GalleryImage[];
};

export type ValidationIssue = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  file?: string;
  fixable: boolean;
  fixId?: string;
};

export type ValidationReport = {
  valid: boolean;
  errors: number;
  warnings: number;
  infos: number;
  issues: ValidationIssue[];
};

export type ExtensionInput = {
  id: string;
  type: "text" | "number" | "boolean" | "password";
  label: string;
  placeholder?: string;
  defaultValue?: any;
  required?: boolean;
};

export type ExtensionInfo = {
  id: string;
  name: string;
  description: string;
  inputs: ExtensionInput[];
};

export type UpdateCheckResponse = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes: string;
  assetName: string;
  assetSize: number;
};

export type UpdateProgressResponse = {
  status: "idle" | "downloading" | "applying" | "completed" | "error";
  percent: number;
  error: string;
};

