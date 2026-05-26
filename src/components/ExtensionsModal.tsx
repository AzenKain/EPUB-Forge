import React, { useState, useEffect, useRef } from "react";
import { X, Play, Puzzle, Terminal, Check, AlertCircle, RefreshCw, Plus, Trash2, Download, Store, Package, Shield, ArrowUpCircle } from "lucide-react";
import type { ExtensionInfo, StoreExtensionInfo } from "../lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onRunSuccess?: (fileNames: string[]) => void;
};

type SidebarTab = "installed" | "store";

type ChoiceOption = {
  id: string;
  label: string;
  description?: string;
};

type ChoicePrompt = {
  choiceId: string;
  prompt: string;
  multiple: boolean;
  options: ChoiceOption[];
};

export function ExtensionsModal({ open, onClose, onRunSuccess }: Props) {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [selectedExt, setSelectedExt] = useState<ExtensionInfo | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [showCaptchaPanel, setShowCaptchaPanel] = useState(false);
  const [captchaScreenshot, setCaptchaScreenshot] = useState("");
  const [inputText, setInputText] = useState("");
  const [sendingInteraction, setSendingInteraction] = useState(false);
  const [choicePrompt, setChoicePrompt] = useState<ChoicePrompt | null>(null);
  const [choiceSelection, setChoiceSelection] = useState<string[]>([]);

  // Store tab state
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("installed");
  const [storeExtensions, setStoreExtensions] = useState<StoreExtensionInfo[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState("");
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const consoleBottomRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshExtensions = async () => {
    try {
      const res = await fetch("/api/extensions");
      if (!res.ok) throw new Error("Không thể tải danh sách extension");
      const data = await res.json();
      setExtensions(data || []);
      return data || [];
    } catch (err: any) {
      setError(err.message || "Lỗi khi tải danh sách extension.");
      return [];
    }
  };

  useEffect(() => {
    if (open) {
      setLoading(true);
      setError("");
      setSuccess("");
      setLogs([]);
      setSelectedExt(null);
      setActiveRunId(null);
      setShowCaptchaPanel(false);
      setCaptchaScreenshot("");
      setInputText("");
      setSendingInteraction(false);
      setChoicePrompt(null);
      setChoiceSelection([]);
      setSidebarTab("installed");
      setStoreExtensions([]);
      setStoreError("");

      fetch("/api/extensions")
        .then((res) => {
          if (!res.ok) throw new Error("Không thể tải danh sách extension");
          return res.json();
        })
        .then((data) => {
          setExtensions(data || []);
          if (data && data.length > 0) {
            handleSelectExtension(data[0]);
          }
        })
        .catch((err) => {
          console.error(err);
          setError(err.message || "Lỗi khi tải danh sách extension.");
        })
        .finally(() => {
          setLoading(false);
        });
    }
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [open]);

  useEffect(() => {
    if (consoleBottomRef.current) {
      consoleBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  useEffect(() => {
    if (sidebarTab === "store" && storeExtensions.length === 0 && !storeLoading) {
      fetchStore();
    }
  }, [sidebarTab]);

  const fetchStore = async () => {
    setStoreLoading(true);
    setStoreError("");
    try {
      const res = await fetch("/api/extensions/store");
      if (!res.ok) throw new Error("Không thể kết nối tới Extension Store");
      const data = await res.json();
      setStoreExtensions(data || []);
    } catch (err: any) {
      setStoreError(err.message || "Lỗi khi tải Extension Store.");
    } finally {
      setStoreLoading(false);
    }
  };

  if (!open) return null;

  const handleSelectExtension = (ext: ExtensionInfo) => {
    setSelectedExt(ext);
    setError("");
    setSuccess("");
    setLogs([]);
    setChoicePrompt(null);
    setChoiceSelection([]);

    const saved = localStorage.getItem(`ext_form_${ext.id}`);
    if (saved) {
      try {
        setFormData(JSON.parse(saved));
        return;
      } catch (e) {
        console.error("Lỗi tải dữ liệu lưu trữ:", e);
      }
    }

    const initialData: Record<string, any> = {};
    if (ext.inputs) {
      ext.inputs.forEach((input) => {
        if (input.defaultValue !== undefined) {
          initialData[input.id] = input.defaultValue;
        } else if (input.type === "boolean") {
          initialData[input.id] = false;
        } else {
          initialData[input.id] = "";
        }
      });
    }
    setFormData(initialData);
  };

  const handleInputChange = (id: string, val: any) => {
    setFormData((prev) => {
      const updated = {
        ...prev,
        [id]: val,
      };
      if (selectedExt) {
        localStorage.setItem(`ext_form_${selectedExt.id}`, JSON.stringify(updated));
      }
      return updated;
    });
  };

  const isInputVisible = (input: NonNullable<ExtensionInfo["inputs"]>[number]) => {
    if (!input.visibleWhen) return true;
    return Object.entries(input.visibleWhen).every(([fieldId, expected]) => {
      const current = formData[fieldId];
      return Array.isArray(expected) ? expected.includes(current) : current === expected;
    });
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!file.name.endsWith(".js")) {
      setError("Chỉ chấp nhận tệp tin tiện ích mở rộng .js");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    const formDataObj = new FormData();
    formDataObj.append("file", file);

    try {
      const response = await fetch("/api/extensions/upload", {
        method: "POST",
        body: formDataObj,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || "Không thể tải lên extension.");
      }

      const newExt = await response.json();
      setSuccess(`Đã thêm thành công extension "${newExt.name}".`);

      const data = await refreshExtensions();
      const found = data?.find((e: any) => e.id === newExt.id);
      if (found) {
        handleSelectExtension(found);
      } else if (data && data.length > 0) {
        handleSelectExtension(data[0]);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Lỗi khi thêm extension.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = async () => {
    if (!selectedExt) return;

    const confirmDelete = window.confirm(`Bạn có chắc chắn muốn xóa extension "${selectedExt.name}" không?`);
    if (!confirmDelete) return;

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/extensions/delete?id=${encodeURIComponent(selectedExt.id)}`, {
        method: "POST",
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || "Không thể xóa extension.");
      }

      setSuccess(`Đã xóa thành công extension "${selectedExt.name}".`);

      const data = await refreshExtensions();
      if (data && data.length > 0) {
        handleSelectExtension(data[0]);
      } else {
        setSelectedExt(null);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Lỗi khi xóa extension.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateExtension = async (id: string) => {
    setUpdatingId(id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/extensions/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || "Không thể cập nhật extension.");
      }
      const updatedExt = await response.json();
      setSuccess(`Đã cập nhật thành công extension "${updatedExt.name}"!`);

      const data = await refreshExtensions();
      const found = data?.find((e: any) => e.id === id);
      if (found) handleSelectExtension(found);

      fetchStore();
    } catch (err: any) {
      setError(err.message || "Lỗi khi cập nhật extension.");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleInstallFromStore = async (item: StoreExtensionInfo) => {
    setInstallingId(item.id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/extensions/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ downloadUrl: item.downloadUrl }),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || "Không thể cài đặt extension.");
      }
      const newExt = await response.json();
      setSuccess(`Đã cài đặt thành công extension "${newExt.name}" từ Store!`);

      const data = await refreshExtensions();
      const found = data?.find((e: any) => e.id === newExt.id);
      if (found) {
        handleSelectExtension(found);
        setSidebarTab("installed");
      }

      fetchStore();
    } catch (err: any) {
      setError(err.message || "Lỗi khi cài đặt extension.");
    } finally {
      setInstallingId(null);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLogs((prev) => [...prev, "[-] Đang ngắt thực thi..."]);
      setShowCaptchaPanel(false);
      setCaptchaScreenshot("");
      setChoicePrompt(null);
      setChoiceSelection([]);
      setActiveRunId(null);
    }
  };

  const handleScreenshotClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeRunId || sendingInteraction) return;
    const img = e.currentTarget.querySelector<HTMLImageElement>(".screenshotImg");
    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    const rect = img.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    if (clickX < 0 || clickY < 0 || clickX > rect.width || clickY > rect.height) {
      return;
    }

    const x = clickX * (img.naturalWidth / rect.width);
    const y = clickY * (img.naturalHeight / rect.height);

    setSendingInteraction(true);
    try {
      const res = await fetch("/api/extensions/interact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: activeRunId,
          action: "click",
          x,
          y,
        }),
      });

      if (!res.ok) {
        throw new Error("Không thể gửi thao tác click");
      }

      const data = await res.json();
      if (data.success && data.screenshot) {
        setCaptchaScreenshot(data.screenshot);
      }
    } catch (err: any) {
      console.error("Lỗi click captcha:", err);
      setLogs((prev) => [...prev, `[-] Lỗi tương tác trình duyệt: ${err.message}`]);
    } finally {
      setSendingInteraction(false);
    }
  };

  const handleSendText = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeRunId || !inputText.trim() || sendingInteraction) return;

    const text = inputText;
    setInputText("");
    setSendingInteraction(true);

    try {
      const res = await fetch("/api/extensions/interact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: activeRunId,
          action: "type",
          text,
        }),
      });

      if (!res.ok) {
        throw new Error("Không thể gửi thao tác nhập chữ");
      }

      const data = await res.json();
      if (data.success && data.screenshot) {
        setCaptchaScreenshot(data.screenshot);
      }
    } catch (err: any) {
      console.error("Lỗi gửi text:", err);
      setLogs((prev) => [...prev, `[-] Lỗi tương tác trình duyệt: ${err.message}`]);
    } finally {
      setSendingInteraction(false);
    }
  };

  const toggleChoice = (optionId: string) => {
    if (!choicePrompt) return;
    setChoiceSelection((prev) => {
      if (!choicePrompt.multiple) return [optionId];
      return prev.includes(optionId)
        ? prev.filter((id) => id !== optionId)
        : [...prev, optionId];
    });
  };

  const handleSubmitChoice = async () => {
    if (!activeRunId || !choicePrompt || choiceSelection.length === 0 || sendingInteraction) return;

    setSendingInteraction(true);
    try {
      const res = await fetch("/api/extensions/interact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: activeRunId,
          action: "choice",
          text: JSON.stringify(choiceSelection),
        }),
      });

      if (!res.ok) {
        throw new Error("Không thể gửi lựa chọn");
      }

      setLogs((prev) => [...prev, `[+] Đã chọn: ${choiceSelection.join(", ")}`]);
      setChoicePrompt(null);
      setChoiceSelection([]);
    } catch (err: any) {
      console.error("Lỗi gửi lựa chọn:", err);
      setLogs((prev) => [...prev, `[-] Lỗi gửi lựa chọn: ${err.message}`]);
    } finally {
      setSendingInteraction(false);
    }
  };

  const handleRun = async () => {
    if (!selectedExt) return;
    setRunning(true);
    setError("");
    setSuccess("");
    setLogs(["[*] Khởi động tiến trình..."]);
    setActiveRunId(null);
    setShowCaptchaPanel(false);
    setCaptchaScreenshot("");
    setInputText("");
    setChoicePrompt(null);
    setChoiceSelection([]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`/api/extensions/run?id=${encodeURIComponent(selectedExt.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error("Không thể khởi động extension hoặc kết nối máy chủ thất bại.");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Không thể kết xuất luồng dữ liệu log.");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.type === "log") {
              setLogs((prev) => [...prev, data.message]);
            } else if (data.type === "start") {
              setActiveRunId(data.runId);
            } else if (data.type === "captcha_required") {
              setCaptchaScreenshot(data.screenshot);
              setShowCaptchaPanel(true);
            } else if (data.type === "captcha_resolved") {
              setShowCaptchaPanel(false);
              setCaptchaScreenshot("");
            } else if (data.type === "choice_required") {
              const options = Array.isArray(data.options) ? data.options : [];
              setChoicePrompt({
                choiceId: data.choiceId || "",
                prompt: data.prompt || "Chọn mục cần tải",
                multiple: data.multiple !== false,
                options,
              });
              setChoiceSelection(options.map((option: ChoiceOption) => option.id));
            } else if (data.type === "done") {
              const fileNames = data.fileNames || (data.fileName ? [data.fileName] : []);
              setSuccess(`Hoàn tất! Đã tạo sách thành công: ${fileNames.join(", ")}`);
              setRunning(false);
              setShowCaptchaPanel(false);
              setCaptchaScreenshot("");
              setChoicePrompt(null);
              setChoiceSelection([]);
              setActiveRunId(null);
              abortControllerRef.current = null;
              if (onRunSuccess) onRunSuccess(fileNames);
            } else if (data.type === "error") {
              setError(data.error || "Gặp lỗi trong quá trình thực thi.");
              setRunning(false);
              setShowCaptchaPanel(false);
              setCaptchaScreenshot("");
              setChoicePrompt(null);
              setChoiceSelection([]);
              setActiveRunId(null);
              abortControllerRef.current = null;
            }
          } catch (e) {
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Đã ngắt thực thi tiện ích mở rộng.");
      } else {
        setError(err.message || "Lỗi khi chạy extension.");
      }
      setRunning(false);
      setShowCaptchaPanel(false);
      setCaptchaScreenshot("");
      setChoicePrompt(null);
      setChoiceSelection([]);
      setActiveRunId(null);
    } finally {
      abortControllerRef.current = null;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="metadataModal extensionsModal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: showCaptchaPanel ? "1350px" : "880px",
          transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: `
          .extensionsModal {
            max-width: 95vw;
            height: 620px;
            max-height: 95vh;
            display: flex;
            flex-direction: column;
            background: #faf9f6;
            border-radius: 12px;
            border: 1px solid #c9c6bd;
            box-shadow: 0 12px 36px rgba(23, 32, 28, 0.15);
            overflow: hidden;
            animation: modalFadeIn 0.2s ease-out;
          }

          .extensionsModalBody {
            display: flex;
            flex: 1;
            overflow: hidden;
            min-height: 0;
            background: #faf9f6;
          }

          /* Left Sidebar: List of Extensions */
          .extensionsListSidebar {
            width: 270px;
            border-right: 1px solid #e2dfd6;
            display: flex;
            flex-direction: column;
            background: #f4f2e9;
            flex-shrink: 0;
            overflow: hidden;
          }

          /* Sidebar Tabs */
          .extSidebarTabs {
            display: flex;
            border-bottom: 1px solid #e2dfd6;
            background: #eae7dc;
            flex-shrink: 0;
          }

          .extSidebarTab {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            padding: 10px 8px;
            font-size: 11.5px;
            font-weight: 700;
            cursor: pointer;
            border: none;
            background: transparent;
            color: #687168;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            transition: all 0.2s ease;
            position: relative;
          }

          .extSidebarTab:hover {
            color: #373e3a;
            background: rgba(31, 98, 77, 0.05);
          }

          .extSidebarTab.active {
            color: #1f624d;
            background: #f4f2e9;
          }

          .extSidebarTab.active::after {
            content: '';
            position: absolute;
            bottom: -1px;
            left: 12px;
            right: 12px;
            height: 2px;
            background: #1f624d;
            border-radius: 2px 2px 0 0;
          }

          .extSidebarContent {
            flex: 1;
            padding: 12px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-height: 0;
          }

          .extListScrollArea {
            flex: 1;
            overflow-y: auto;
            margin-bottom: 12px;
            min-height: 0;
          }

          .addExtBtn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            width: 100%;
            padding: 8px 12px;
            background-color: #fff;
            border: 1px dashed #1f624d;
            border-radius: 6px;
            color: #1f624d;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
          }

          .addExtBtn:hover:not(:disabled) {
            background-color: #e8f5e9;
            border-color: #1b5e20;
          }

          .addExtBtn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }

          .deleteExtBtn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: 6px;
            border: 1px solid #e2dfd6;
            background-color: #fff;
            color: #ba2525;
            cursor: pointer;
            transition: all 0.2s ease;
            flex-shrink: 0;
          }

          .deleteExtBtn:hover:not(:disabled) {
            background-color: #ffebee;
            border-color: #ba2525;
          }

          .deleteExtBtn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }

          .extItemRow {
            padding: 9px 10px;
            border-radius: 6px;
            border: 1px solid transparent;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
            text-align: left;
            background: none;
            width: 100%;
          }

          .extItemRow:hover {
            background: #eae6db;
            border-color: #c9c6bd;
          }

          .extItemRow.active {
            background: #1f624d;
            color: #fff;
            border-color: #1f624d;
          }

          .extItemInfo {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 3px;
          }

          .extItemName {
            font-size: 12.5px;
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .extItemBadges {
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
          }

          .extBadge {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 9.5px;
            font-weight: 700;
            letter-spacing: 0.2px;
            text-transform: uppercase;
            line-height: 1.5;
            white-space: nowrap;
          }

          .extBadge.official {
            background: rgba(31, 98, 77, 0.15);
            color: #1f624d;
          }

          .extItemRow.active .extBadge.official {
            background: rgba(255, 255, 255, 0.2);
            color: #c8e6c9;
          }

          .extBadge.thirdparty {
            background: rgba(104, 113, 104, 0.12);
            color: #687168;
          }

          .extItemRow.active .extBadge.thirdparty {
            background: rgba(255, 255, 255, 0.15);
            color: #b0bfb0;
          }

          .extBadge.update {
            background: rgba(230, 126, 34, 0.15);
            color: #d35400;
            animation: badgePulse 2s ease-in-out infinite;
          }

          .extItemRow.active .extBadge.update {
            background: rgba(255, 200, 100, 0.3);
            color: #ffd180;
          }

          @keyframes badgePulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
          }

          /* Store item styles */
          .storeItemRow {
            padding: 10px 12px;
            border-radius: 8px;
            border: 1px solid #e2dfd6;
            background: #fff;
            margin-bottom: 8px;
            transition: all 0.2s ease;
          }

          .storeItemRow:hover {
            border-color: #c9c6bd;
            box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          }

          .storeItemHeader {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
          }

          .storeItemName {
            font-size: 13px;
            font-weight: 700;
            color: #1a231f;
            flex: 1;
          }

          .storeItemMeta {
            font-size: 10.5px;
            color: #8c8f8c;
          }

          .storeItemDesc {
            font-size: 11.5px;
            color: #687168;
            line-height: 1.4;
            margin-bottom: 8px;
          }

          .storeItemActions {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .storeInstallBtn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 14px;
            border-radius: 5px;
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            border: 1px solid #1f624d;
            background: #1f624d;
            color: #fff;
          }

          .storeInstallBtn:hover:not(:disabled) {
            background: #174d3b;
          }

          .storeInstallBtn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }

          .storeInstallBtn.installed {
            background: #f4f2e9;
            color: #687168;
            border-color: #e2dfd6;
            cursor: default;
          }

          .storeUpdateBtn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 14px;
            border-radius: 5px;
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            border: 1px solid #e67e22;
            background: #e67e22;
            color: #fff;
          }

          .storeUpdateBtn:hover:not(:disabled) {
            background: #d35400;
          }

          .storeUpdateBtn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }

          .updateExtBtn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 12px;
            border-radius: 5px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            border: 1px solid #e67e22;
            background: #e67e22;
            color: #fff;
            white-space: nowrap;
          }

          .updateExtBtn:hover:not(:disabled) {
            background: #d35400;
            border-color: #d35400;
          }

          .updateExtBtn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }

          /* Right Panel: Content Form & Console */
          .extContentPanel {
            flex: 1;
            padding: 20px;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            min-width: 0;
          }

          .extHeaderArea {
            border-bottom: 1px solid #e2dfd6;
            padding-bottom: 14px;
            margin-bottom: 16px;
          }

          .extHeaderArea h4 {
            font-size: 16px;
            font-weight: 700;
            color: #1a231f;
            margin: 0 0 4px 0;
          }

          .extHeaderArea p {
            font-size: 12px;
            color: #687168;
            margin: 0;
            line-height: 1.4;
          }

          .extFormArea {
            display: flex;
            flex-direction: column;
            gap: 12px;
            flex: 1;
          }

          .extFormGroup {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .extFormGroup label {
            font-size: 12px;
            font-weight: 600;
            color: #373e3a;
          }

          .extInputText {
            width: 100%;
            border: 1px solid #c9c6bd;
            border-radius: 6px;
            padding: 8px 10px;
            font-size: 13px;
            background: #fff;
            transition: all 0.2s ease;
          }

          .extInputText:focus {
            border-color: #1f624d;
            box-shadow: 0 0 0 2px rgba(31, 98, 77, 0.15);
            outline: none;
          }

          .extCheckboxLabel {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            font-size: 13px;
            color: #373e3a;
            padding: 4px 0;
          }

          /* Console logs panel */
          .extConsoleLogs {
            background: #1e1e1e;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 12px;
            font-family: 'Consolas', 'Courier New', Courier, monospace;
            font-size: 11px;
            color: #ddd;
            height: 180px;
            overflow-y: auto;
            margin-top: 16px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            box-shadow: inset 0 2px 8px rgba(0,0,0,0.5);
          }

          .consoleLine {
            line-height: 1.4;
            white-space: pre-wrap;
            word-break: break-all;
          }

          .consoleLine.error { color: #f48c8c; }
          .consoleLine.success { color: #8cf4a8; }
          .consoleLine.info { color: #8cd2f4; }

          .choicePanel {
            border: 1px solid #d7d2c5;
            background: #fffaf0;
            border-radius: 8px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .choicePanel h5 {
            margin: 0;
            font-size: 13px;
            color: #1f624d;
          }

          .choiceList {
            display: flex;
            flex-direction: column;
            gap: 6px;
            max-height: 220px;
            overflow-y: auto;
          }

          .choiceItem {
            display: flex;
            gap: 8px;
            align-items: flex-start;
            border: 1px solid #e5dfd2;
            border-radius: 6px;
            background: #fff;
            padding: 8px;
            cursor: pointer;
          }

          .choiceItem input {
            margin-top: 2px;
          }

          .choiceItemText {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
          }

          .choiceItemText strong {
            font-size: 12px;
            color: #26302b;
            line-height: 1.25;
          }

          .choiceItemText span {
            font-size: 11px;
            color: #6b716c;
            line-height: 1.35;
          }

          .choiceActions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
          }

          .captchaPanel {
            width: 680px;
            border-left: 1px solid #e2dfd6;
            padding: 20px;
            display: flex;
            flex-direction: column;
            background: #f4f2e9;
            flex-shrink: 0;
            overflow: hidden;
          }
          
          .captchaHeader {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
            border-bottom: 1px solid #e2dfd6;
            padding-bottom: 8px;
          }
          
          .captchaHeader h4 {
            margin: 0;
            font-size: 13px;
            font-weight: 700;
            color: #1f624d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          
          .captchaInstruction {
            font-size: 11px;
            color: #555;
            margin-bottom: 12px;
            line-height: 1.4;
          }

          .screenshotWrapper {
            position: relative;
            width: 640px;
            height: 480px;
            background: #000;
            border: 1px solid #c9c6bd;
            border-radius: 6px;
            overflow: hidden;
            cursor: crosshair;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          }

          .screenshotImg {
            width: 100%;
            height: 100%;
            object-fit: contain;
            user-select: none;
            -webkit-user-drag: none;
          }

          .captchaLoadingOverlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-size: 13px;
            font-weight: 600;
            backdrop-filter: blur(1px);
          }

          .captchaInputBar {
            display: flex;
            gap: 8px;
            margin-top: 12px;
          }

          .captchaInput {
            flex: 1;
            border: 1px solid #c9c6bd;
            border-radius: 6px;
            padding: 8px 10px;
            font-size: 13px;
            background: #fff;
            transition: all 0.2s ease;
          }

          .captchaInput:focus {
            border-color: #1f624d;
            box-shadow: 0 0 0 2px rgba(31, 98, 77, 0.15);
            outline: none;
          }

          .storeEmptyState {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 32px 16px;
            color: #8c8f8c;
            text-align: center;
            gap: 8px;
          }

          .storeEmptyState p {
            font-size: 12px;
            line-height: 1.4;
            margin: 0;
          }

          .extensionsModal .toastMessage {
            display: flex;
            align-items: center;
            gap: 8px;
            border-radius: 7px;
            padding: 9px 12px;
            font-size: 12px;
            line-height: 1.35;
            min-width: 0;
          }

          .extensionsModal .toastMessage svg {
            flex: 0 0 auto;
          }

          .extensionsModal .toastMessage span {
            min-width: 0;
            overflow-wrap: anywhere;
          }

          .extensionsModal .toastMessage.error {
            margin-bottom: 0;
            border: 1px solid #d79a89;
            background: #fff1ec;
            color: #8f2c18;
          }

          .extensionsModal .toastMessage.success {
            margin-bottom: 0;
            border: 1px solid #94bfa7;
            background: #eef8f2;
            color: #1f624d;
          }

          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          .animate-spin {
            animation: spin 1s linear infinite;
          }
        ` }} />

        <header className="modalHeader">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Puzzle size={20} className="text-[#1f624d]" />
            <div>
              <h3 style={{ margin: 0 }}>Tiện ích mở rộng (Extensions)</h3>
              <p style={{ margin: 0, fontSize: "11px", color: "#687168" }}>
                Chạy các script mở rộng để tải sách, định dạng hoặc xử lý dữ liệu.
              </p>
            </div>
          </div>
          <button className="iconButton" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="extensionsModalBody">
          {/* Sidebar */}
          <div className="extensionsListSidebar">
            {/* Tabs */}
            <div className="extSidebarTabs">
              <button
                type="button"
                className={`extSidebarTab ${sidebarTab === "installed" ? "active" : ""}`}
                onClick={() => setSidebarTab("installed")}
              >
                <Package size={13} />
                <span>Đã cài ({extensions.length})</span>
              </button>
              <button
                type="button"
                className={`extSidebarTab ${sidebarTab === "store" ? "active" : ""}`}
                onClick={() => setSidebarTab("store")}
              >
                <Store size={13} />
                <span>Cửa hàng</span>
              </button>
            </div>

            <div className="extSidebarContent">
              {/* ===== Installed Tab ===== */}
              {sidebarTab === "installed" && (
                <>
                  <div className="extListScrollArea">
                    {loading ? (
                      <div style={{ fontSize: "12px", color: "#687168", padding: "12px 0" }}>
                        Đang quét thư mục...
                      </div>
                    ) : extensions.length === 0 ? (
                      <div className="storeEmptyState">
                        <Package size={28} style={{ opacity: 0.4 }} />
                        <p>Chưa có extension nào được cài đặt.</p>
                        <p style={{ fontSize: "11px" }}>Thêm file .js hoặc duyệt Cửa hàng để bắt đầu.</p>
                      </div>
                    ) : (
                      extensions.map((ext) => (
                        <button
                          key={ext.id}
                          type="button"
                          className={`extItemRow ${selectedExt?.id === ext.id ? "active" : ""}`}
                          onClick={() => handleSelectExtension(ext)}
                          disabled={running}
                        >
                          <Puzzle size={14} style={{ flexShrink: 0 }} />
                          <div className="extItemInfo">
                            <span className="extItemName" title={ext.name}>{ext.name}</span>
                            <div className="extItemBadges">
                              {ext.isOfficial ? (
                                <span className="extBadge official">
                                  <Shield size={8} />
                                  Chính thức
                                </span>
                              ) : (
                                <span className="extBadge thirdparty">
                                  Bên thứ ba
                                </span>
                              )}
                              {ext.hasUpdate && (
                                <span className="extBadge update">
                                  <ArrowUpCircle size={8} />
                                  Có cập nhật
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  {/* Pinned Upload Button */}
                  <div style={{ borderTop: "1px solid #e2dfd6", paddingTop: "12px" }}>
                    <button
                      type="button"
                      className="addExtBtn"
                      onClick={handleUploadClick}
                      disabled={running || loading}
                      title="Tải lên tệp tin .js mới"
                    >
                      <Plus size={14} />
                      <span>Thêm Extension</span>
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept=".js"
                      style={{ display: "none" }}
                    />
                  </div>
                </>
              )}

              {/* ===== Store Tab ===== */}
              {sidebarTab === "store" && (
                <div className="extListScrollArea" style={{ marginBottom: 0 }}>
                  {storeLoading ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "24px 0", color: "#687168" }}>
                      <RefreshCw size={20} className="animate-spin" />
                      <span style={{ fontSize: "12px" }}>Đang tải từ GitHub...</span>
                    </div>
                  ) : storeError ? (
                    <div className="storeEmptyState">
                      <AlertCircle size={24} style={{ color: "#ba2525", opacity: 0.7 }} />
                      <p style={{ color: "#ba2525" }}>{storeError}</p>
                      <button
                        type="button"
                        className="addExtBtn"
                        onClick={fetchStore}
                        style={{ marginTop: "8px", maxWidth: "160px" }}
                      >
                        <RefreshCw size={12} />
                        Thử lại
                      </button>
                    </div>
                  ) : storeExtensions.length === 0 ? (
                    <div className="storeEmptyState">
                      <Store size={28} style={{ opacity: 0.4 }} />
                      <p>Không tìm thấy extension nào trên Store.</p>
                    </div>
                  ) : (
                    storeExtensions.map((item) => (
                      <div key={item.id} className="storeItemRow">
                        <div className="storeItemHeader">
                          <Shield size={13} style={{ color: "#1f624d", flexShrink: 0 }} />
                          <span className="storeItemName">{item.name}</span>
                          <span className="storeItemMeta">{formatFileSize(item.size)}</span>
                        </div>
                        <div className="storeItemDesc">{item.description}</div>
                        <div className="storeItemActions">
                          {item.installed && item.hasUpdate ? (
                            <button
                              type="button"
                              className="storeUpdateBtn"
                              onClick={() => handleInstallFromStore(item)}
                              disabled={installingId === item.id}
                            >
                              {installingId === item.id ? (
                                <RefreshCw size={12} className="animate-spin" />
                              ) : (
                                <ArrowUpCircle size={12} />
                              )}
                              <span>Cập nhật</span>
                            </button>
                          ) : item.installed ? (
                            <span className="storeInstallBtn installed">
                              <Check size={12} />
                              <span>Đã cài</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="storeInstallBtn"
                              onClick={() => handleInstallFromStore(item)}
                              disabled={installingId === item.id}
                            >
                              {installingId === item.id ? (
                                <RefreshCw size={12} className="animate-spin" />
                              ) : (
                                <Download size={12} />
                              )}
                              <span>{installingId === item.id ? "Đang cài..." : "Cài đặt"}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Configuration Form & Progress console */}
          <div className="extContentPanel">
            {selectedExt ? (
              <>
                <div className="extHeaderArea" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, marginRight: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <h4 style={{ margin: 0 }}>{selectedExt.name}</h4>
                      {selectedExt.isOfficial && (
                        <span className="extBadge official" style={{ fontSize: "10px" }}>
                          <Shield size={9} />
                          Chính thức
                        </span>
                      )}
                    </div>
                    <p style={{ margin: "4px 0 0 0" }}>{selectedExt.description}</p>
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    {selectedExt.hasUpdate && (
                      <button
                        type="button"
                        className="updateExtBtn"
                        onClick={() => handleUpdateExtension(selectedExt.id)}
                        disabled={updatingId === selectedExt.id || running || loading}
                        title="Cập nhật lên bản mới nhất từ Store"
                      >
                        {updatingId === selectedExt.id ? (
                          <RefreshCw size={12} className="animate-spin" />
                        ) : (
                          <ArrowUpCircle size={12} />
                        )}
                        <span>Cập nhật</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="deleteExtBtn"
                      onClick={handleDeleteClick}
                      disabled={running || loading}
                      title="Xóa extension này"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="extFormArea">
                  {/* Render inputs dynamically */}
                  {selectedExt.inputs && selectedExt.inputs.filter(isInputVisible).map((input) => (
                    <div key={input.id} className="extFormGroup">
                      {input.type !== "boolean" && (
                        <label>
                          {input.label}
                          {input.required && <span style={{ color: "#ba2525" }}> *</span>}
                        </label>
                      )}

                      {input.type === "text" && (
                        <input
                          type="text"
                          className="extInputText"
                          placeholder={input.placeholder || ""}
                          value={formData[input.id] || ""}
                          onChange={(e) => handleInputChange(input.id, e.target.value)}
                          disabled={running}
                          required={input.required}
                        />
                      )}

                      {input.type === "password" && (
                        <input
                          type="password"
                          className="extInputText"
                          placeholder={input.placeholder || "••••••••"}
                          value={formData[input.id] || ""}
                          onChange={(e) => handleInputChange(input.id, e.target.value)}
                          disabled={running}
                          required={input.required}
                        />
                      )}

                      {input.type === "number" && (
                        <input
                          type="number"
                          className="extInputText"
                          placeholder={input.placeholder || ""}
                          value={formData[input.id] ?? ""}
                          onChange={(e) => handleInputChange(input.id, e.target.value === "" ? "" : Number(e.target.value))}
                          disabled={running}
                          required={input.required}
                        />
                      )}

                      {input.type === "select" && (
                        <select
                          className="extInputText"
                          value={formData[input.id] || ""}
                          onChange={(e) => handleInputChange(input.id, e.target.value)}
                          disabled={running}
                          required={input.required}
                        >
                          {(input.options || []).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}

                      {input.type === "boolean" && (
                        <label className="extCheckboxLabel">
                          <input
                            type="checkbox"
                            checked={!!formData[input.id]}
                            onChange={(e) => handleInputChange(input.id, e.target.checked)}
                            disabled={running}
                          />
                          <span>{input.label}</span>
                        </label>
                      )}
                    </div>
                  ))}

                  {choicePrompt && (
                    <div className="choicePanel">
                      <h5>{choicePrompt.prompt}</h5>
                      <div className="choiceList">
                        {choicePrompt.options.map((option) => {
                          const checked = choiceSelection.includes(option.id);
                          return (
                            <label key={option.id} className="choiceItem">
                              <input
                                type={choicePrompt.multiple ? "checkbox" : "radio"}
                                checked={checked}
                                onChange={() => toggleChoice(option.id)}
                                disabled={sendingInteraction}
                              />
                              <span className="choiceItemText">
                                <strong>{option.label}</strong>
                                {option.description && <span>{option.description}</span>}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="choiceActions">
                        <button
                          type="button"
                          className="smallButton strong"
                          onClick={handleSubmitChoice}
                          disabled={sendingInteraction || choiceSelection.length === 0}
                        >
                          Xác nhận lựa chọn
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Run logs console */}
                  {(running || logs.length > 0) && (
                    <div className="extConsoleLogs">
                      {logs.map((log, index) => {
                        let cls = "consoleLine";
                        if (log.startsWith("[-]")) cls += " error";
                        else if (log.startsWith("[+]")) cls += " success";
                        else if (log.startsWith("[*]")) cls += " info";
                        return (
                          <div key={index} className={cls}>
                            {log}
                          </div>
                        );
                      })}
                      <div ref={consoleBottomRef} />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", color: "#888", fontSize: "13px", flexDirection: "column", gap: "8px" }}>
                <Puzzle size={32} style={{ opacity: 0.2 }} />
                {sidebarTab === "store"
                  ? "Cài đặt extension từ Cửa hàng để bắt đầu sử dụng."
                  : "Chọn một tiện ích mở rộng ở thanh bên để cấu hình."}
              </div>
            )}
          </div>

          {/* Captcha Panel */}
          {showCaptchaPanel && (
            <div className="captchaPanel">
              <div className="captchaHeader">
                <h4>Trình duyệt Tương tác (Captcha)</h4>
                {sendingInteraction && <RefreshCw size={14} className="animate-spin text-[#1f624d]" />}
              </div>
              <p className="captchaInstruction">
                Vui lòng click trực tiếp vào ảnh chụp trình duyệt bên dưới hoặc nhập ký tự/chữ cần thiết để vượt qua Cloudflare.
              </p>
              
              <div className="screenshotWrapper" onClick={handleScreenshotClick}>
                {captchaScreenshot ? (
                  <img 
                    src={captchaScreenshot} 
                    alt="Browser Screenshot" 
                    className="screenshotImg"
                  />
                ) : (
                  <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", height: "100%", color: "#888", fontSize: "12px" }}>
                    Đang tải ảnh chụp màn hình...
                  </div>
                )}
                {sendingInteraction && (
                  <div className="captchaLoadingOverlay">
                    Đang xử lý tương tác...
                  </div>
                )}
              </div>
              
              <form onSubmit={handleSendText} className="captchaInputBar">
                <input
                  type="text"
                  className="captchaInput"
                  placeholder="Nhập chữ/mã cần gõ vào trang web..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={sendingInteraction}
                />
                <button
                  type="submit"
                  className="smallButton strong"
                  disabled={sendingInteraction || !inputText.trim()}
                  style={{ padding: "0 16px" }}
                >
                  Gửi chữ
                </button>
              </form>
            </div>
          )}
        </div>

        <footer className="modalFooter" style={{ gap: "10px" }}>
          {error && (
            <div className="toastMessage error" style={{ flex: 1, margin: 0 }}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="toastMessage success" style={{ flex: 1, margin: 0 }}>
              <Check size={14} />
              <span>{success}</span>
            </div>
          )}
          
          <button 
            type="button" 
            className="smallButton" 
            onClick={onClose} 
          >
            Đóng
          </button>
          
          {selectedExt && (
            running ? (
              <button
                type="button"
                className="smallButton"
                onClick={handleStop}
                style={{ minWidth: "140px", backgroundColor: "#ba2525", color: "#fff", borderColor: "#ba2525" }}
              >
                <X size={14} />
                <span>Dừng (Ngắt)</span>
              </button>
            ) : (
              <button
                type="button"
                className="smallButton strong"
                onClick={handleRun}
                disabled={!selectedExt}
                style={{ minWidth: "140px" }}
              >
                <Play size={14} />
                <span>Chạy Extension</span>
              </button>
            )
          )}
        </footer>
      </section>
    </div>
  );
}
