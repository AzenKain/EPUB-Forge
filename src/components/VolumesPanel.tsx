import React, { useState } from "react";
import { Download, Layers, Plus, Scissors, Trash2, Image as ImageIcon } from "lucide-react";
import type { BookAnalysis, ExportRange, ExportedFile } from "../lib/types";
import { clamp, detectSummary, formatBytes } from "../lib/format";
import { CoverModal } from "./CoverModal";

type Props = {
  analysis: BookAnalysis;
  ranges: ExportRange[];
  includeFrontmatter: boolean;
  busy: boolean;
  exports: ExportedFile[];
  exportProgress: { index: number; total: number; label: string } | null;
  onApplyDetected: () => void;
  onAddRange: () => void;
  onUpdateRange: (index: number, patch: Partial<ExportRange>) => void;
  onRemoveRange: (index: number) => void;
  onIncludeFrontmatterChange: (value: boolean) => void;
  onExport: () => void;
};

export function VolumesPanel({
  analysis,
  ranges,
  includeFrontmatter,
  busy,
  exports,
  exportProgress,
  onApplyDetected,
  onAddRange,
  onUpdateRange,
  onRemoveRange,
  onIncludeFrontmatterChange,
  onExport
}: Props) {
  const maxIndex = Math.max(analysis.spine.length - 1, 0);

  const [coverModalOpen, setCoverModalOpen] = useState(false);
  const [activeRangeIdx, setActiveRangeIdx] = useState<number>(0);

  const activeRange = ranges[activeRangeIdx] || null;

  const handleSaveCover = (index: number, coverValue: string) => {
    onUpdateRange(index, { coverImage: coverValue });
  };

  return (
    <section className="panel splitPanel">
      <div className="panelHeader">
        <h3>
          <Layers size={17} />
          Volumes
        </h3>
        <button className="iconButton" onClick={onAddRange} title="Thêm khoảng">
          <Plus size={17} />
        </button>
      </div>

      {}
      {analysis.coverPath && (
        <div className="originalCoverBox">
          <span className="boxLabel">Ảnh bìa gốc của sách</span>
          <div className="boxContent">
            <img
              src={`/api/epubs/${encodeURIComponent(analysis.id)}/assets?path=${encodeURIComponent(analysis.coverPath)}`}
              alt="Original Book Cover"
              className="originalCoverPreview"
            />
            <div className="originalCoverMeta">
              <strong>{metadataTitle(analysis)}</strong>
              <p>{analysis.creator || "Unknown Creator"}</p>
              <small>{analysis.spine.length} Spine Items</small>
            </div>
          </div>
        </div>
      )}

      <div className="detectBox">
        <div>
          <strong>Auto-detect</strong>
          <p>{detectSummary(analysis.detectedVolumes.length)}</p>
        </div>
        <button className="smallButton" onClick={onApplyDetected} disabled={!analysis.detectedVolumes.length}>
          Áp dụng
        </button>
      </div>

      <label className="checkRow">
        <input
          type="checkbox"
          checked={includeFrontmatter}
          onChange={(event) => onIncludeFrontmatterChange(event.target.checked)}
        />
        <span>Thêm title/index đầu sách vào mỗi EPUB</span>
      </label>

      <div className="rangeHeader">
        <span>Cover</span>
        <span>Label</span>
        <span>Start</span>
        <span>End</span>
      </div>
      <div className="ranges">
        {ranges.map((range, idx) => {
          const coverSrc = range.coverImage
            ? (range.coverImage.startsWith("data:") || range.coverImage.startsWith("http")
                ? range.coverImage
                : `/api/epubs/${encodeURIComponent(analysis.id)}/assets?path=${encodeURIComponent(range.coverImage)}`)
            : (analysis.coverPath
                ? `/api/epubs/${encodeURIComponent(analysis.id)}/assets?path=${encodeURIComponent(analysis.coverPath)}`
                : "");

          return (
            <div className="rangeRow" key={`${idx}-${range.label}`}>
              <button
                type="button"
                className={`rangeCoverBtn ${range.coverImage ? "hasCustomCover" : ""}`}
                onClick={() => {
                  setActiveRangeIdx(idx);
                  setCoverModalOpen(true);
                }}
                title="Cấu hình ảnh bìa riêng cho Volume này"
              >
                {coverSrc ? (
                  <img src={coverSrc} alt="Vol Cover" className="rangeCoverThumb" />
                ) : (
                  <ImageIcon size={14} className="defaultIcon" />
                )}
                {range.coverImage && <span className="customCoverIndicator" />}
              </button>
              <input value={range.label} onChange={(event) => onUpdateRange(idx, { label: event.target.value })} />
              <NumberField value={range.startIndex} max={maxIndex} onChange={(value) => onUpdateRange(idx, { startIndex: value })} />
              <NumberField value={range.endIndex} max={maxIndex} onChange={(value) => onUpdateRange(idx, { endIndex: value })} />
              <button className="iconButton danger" onClick={() => onRemoveRange(idx)} title="Xóa khoảng">
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </div>

      <button className="primaryButton" onClick={onExport} disabled={busy || ranges.length === 0}>
        <Scissors size={18} />
        <span>Tách EPUB</span>
      </button>

      {exportProgress && (
        <div className="progressWrapper">
          <div className="progressText">
            <span>Đang xuất: {exportProgress.label}</span>
            <span>{Math.round((exportProgress.index / exportProgress.total) * 100)}%</span>
          </div>
          <div className="progressBarContainer">
            <div className="progressBar" style={{ width: `${(exportProgress.index / exportProgress.total) * 100}%` }}></div>
          </div>
        </div>
      )}

      {exports.length ? (
        <div className="exports">
          {exports.map((file) => (
            <a key={file.path} href={file.url}>
              <Download size={16} />
              <span>{file.name}</span>
              <small>{formatBytes(file.size)}</small>
            </a>
          ))}
        </div>
      ) : null}

      <CoverModal
        open={coverModalOpen}
        analysis={analysis}
        rangeIndex={activeRangeIdx}
        range={activeRange}
        includeFrontmatter={includeFrontmatter}
        onSaveCover={handleSaveCover}
        onClose={() => setCoverModalOpen(false)}
      />
    </section>
  );
}

function metadataTitle(analysis: BookAnalysis) {
  return analysis.metadata?.title || analysis.title || "Unknown Book";
}

function NumberField({ value, max, onChange }: { value: number; max: number; onChange: (value: number) => void }) {
  return (
    <input
      type="number"
      min={0}
      max={max}
      value={value}
      onChange={(event) => onChange(clamp(Number(event.target.value), 0, max))}
    />
  );
}
