import {
  startTransition,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheckCircle,
  faCircleXmark,
  faCodeBranch,
  faCopy,
  faCompress,
  faMagnifyingGlass,
  faRotate,
  faArrowUpRightFromSquare,
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
import { listen } from "@tauri-apps/api/event";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-java";
import "prismjs/components/prism-kotlin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  TreeView,
  type TreeDataItem,
  type TreeRenderItemParams,
} from "@/components/ui/tree-view";
import { cn } from "@/lib/utils";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type ParseState =
  | { valid: true; value: JsonValue; error: null }
  | { valid: false; value: null; error: string };

type JsonTreeItem = TreeDataItem & {
  path: string;
  value: JsonValue;
  label: string;
  summary: string;
};

type UpdateCheckState = {
  status: "idle" | "checking" | "available" | "current" | "error";
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  checkedAt: string | null;
  message: string;
};

type GitHubRelease = {
  tag_name?: string;
  html_url?: string;
  name?: string;
  published_at?: string;
};

const LATEST_RELEASE_API_URL =
  "https://api.github.com/repos/gexiaowei/json-handle-mac/releases/latest";
const RELEASES_URL =
  "https://github.com/gexiaowei/json-handle-mac/releases/latest";
const PROJECT_URL = "https://github.com/gexiaowei/json-handle-mac";

const sampleJson = `{
  "name": "JSON Handle",
  "platform": "macOS",
  "features": [
    "Format and minify JSON",
    "Validate parse errors",
    "Open and save local files",
    "Tree view with collapse controls"
  ],
  "meta": {
    "author": "Tauri App",
    "version": 1,
    "active": true
  }
}`;

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown parsing error";
}

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "").split(/[+-]/)[0];
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersion(left).split(".").map(Number);
  const rightParts = normalizeVersion(right).split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightPart = Number.isFinite(rightParts[index])
      ? rightParts[index]
      : 0;

    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
}

async function getCurrentAppVersion() {
  if (!("__TAURI_INTERNALS__" in window)) {
    return __APP_VERSION__;
  }

  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

async function openExternalUrl(url: string) {
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external_url", { url });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function parseSource(source: string): ParseState {
  if (!source.trim()) {
    return {
      valid: false,
      value: null,
      error: "Paste or open a JSON document to begin.",
    };
  }

  try {
    return {
      valid: true,
      value: JSON.parse(source) as JsonValue,
      error: null,
    };
  } catch (error) {
    return {
      valid: false,
      value: null,
      error: formatError(error),
    };
  }
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarize(value: JsonValue) {
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    return `Object(${Object.keys(value).length})`;
  }
  return JSON.stringify(value);
}

function pathToSegments(path: string) {
  if (path === "$") {
    return [];
  }
  return path
    .slice(2)
    .split(".")
    .flatMap((seg) => {
      const parts: string[] = [];
      let current = "";
      for (let i = 0; i < seg.length; i += 1) {
        const char = seg[i];
        if (char === "[") {
          if (current) {
            parts.push(current);
            current = "";
          }
          const close = seg.indexOf("]", i);
          parts.push(seg.slice(i + 1, close));
          i = close;
        } else {
          current += char;
        }
      }
      if (current) {
        parts.push(current);
      }
      return parts.filter(Boolean);
    })
    .filter(Boolean);
}

function setJsonAtPath(root: JsonValue, path: string, nextValue: JsonValue) {
  if (path === "$") {
    return nextValue;
  }
  const updated = root;
  const segments = pathToSegments(path);
  let cursor: JsonValue = updated;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    const index = Number(key);
    if (Number.isNaN(index)) {
      if (!isJsonObject(cursor)) {
        return updated;
      }
      cursor = cursor[key];
    } else {
      if (!Array.isArray(cursor)) {
        return updated;
      }
      cursor = cursor[index];
    }
  }
  const last = segments[segments.length - 1];
  const lastIndex = Number(last);
  if (Number.isNaN(lastIndex)) {
    if (!isJsonObject(cursor)) {
      return updated;
    }
    cursor[last] = nextValue;
  } else {
    if (!Array.isArray(cursor)) {
      return updated;
    }
    cursor[lastIndex] = nextValue;
  }
  return updated as JsonValue;
}

function deleteJsonAtPath(root: JsonValue, path: string) {
  if (path === "$") {
    return root;
  }

  const updated = root;
  const segments = pathToSegments(path);
  const parentSegments = segments.slice(0, -1);
  const last = segments[segments.length - 1];
  let cursor: JsonValue = updated;

  for (const seg of parentSegments) {
    const index = Number(seg);
    if (Number.isNaN(index)) {
      if (!isJsonObject(cursor)) {
        return updated;
      }
      cursor = cursor[seg];
    } else {
      if (!Array.isArray(cursor)) {
        return updated;
      }
      cursor = cursor[index];
    }

    if (cursor === undefined) {
      return updated;
    }
  }

  const lastIndex = Number(last);
  if (Number.isNaN(lastIndex)) {
    if (!isJsonObject(cursor)) {
      return updated;
    }
    delete cursor[last];
    return updated;
  }

  if (!Array.isArray(cursor)) {
    return updated;
  }

  cursor.splice(lastIndex, 1);
  return updated;
}

function getJsonAtPath(root: JsonValue, path: string): JsonValue | null {
  if (path === "$") {
    return root;
  }
  const segments = pathToSegments(path);
  let cursor: JsonValue = root;
  for (const seg of segments) {
    const index = Number(seg);
    if (Number.isNaN(index)) {
      if (!isJsonObject(cursor)) {
        return null;
      }
      cursor = cursor[seg];
    } else {
      if (!Array.isArray(cursor)) {
        return null;
      }
      cursor = cursor[index];
    }
    if (cursor === undefined) {
      return null;
    }
  }
  return cursor;
}

function toTreeData(
  value: JsonValue,
  path = "$",
  label = "root",
): JsonTreeItem {
  const item: JsonTreeItem = {
    id: path,
    name: label,
    label,
    path,
    value,
    summary: summarize(value),
  };

  if (Array.isArray(value)) {
    item.children = value.map((child, index) =>
      toTreeData(child, `${path}[${index}]`, `[${index}]`),
    );
  } else if (isJsonObject(value)) {
    item.children = Object.entries(value).map(([key, child]) =>
      toTreeData(child, `${path}.${key}`, key),
    );
  }

  return item;
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase();
}

function stringValueMatches(value: JsonValue, query: string) {
  return typeof value === "string" && value.toLocaleLowerCase().includes(query);
}

function countStringSearchMatches(item: JsonTreeItem, query: string) {
  let count = stringValueMatches(item.value, query) ? 1 : 0;

  for (const child of item.children ?? []) {
    count += countStringSearchMatches(child as JsonTreeItem, query);
  }

  return count;
}

function highlightText(text: string, query: string): ReactNode {
  if (!query) {
    return text;
  }

  const lowerText = text.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(query);
  let key = 0;

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }
    const end = matchIndex + query.length;
    parts.push(
      <mark
        key={`match-${key}`}
        className="rounded bg-amber-200 px-0.5 text-amber-950"
      >
        {text.slice(matchIndex, end)}
      </mark>,
    );
    cursor = end;
    matchIndex = lowerText.indexOf(query, cursor);
    key += 1;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
}

async function openFileFromBrowser() {
  return new Promise<{ text: string; name: string } | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json,.txt";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ text: await file.text(), name: file.name });
    };
    input.click();
  });
}

async function saveFileFromBrowser(contents: string, fallbackName: string) {
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fallbackName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function App() {
  const [source, setSource] = useState(sampleJson);
  const [debouncedSource, setDebouncedSource] = useState(sampleJson);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const stringSearchRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState("Ready");
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [indentSize, setIndentSize] = useState<2 | 4>(2);
  const [genLang, setGenLang] = useState<"ts" | "java" | "kt">("ts");
  const [generated, setGenerated] = useState("");
  const [showGenerator, setShowGenerator] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>({
    status: "idle",
    currentVersion: __APP_VERSION__,
    latestVersion: null,
    releaseUrl: RELEASES_URL,
    checkedAt: null,
    message:
      "Click Check for Updates to compare with the latest GitHub release.",
  });
  const [stringSearch, setStringSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    value: JsonValue;
  } | null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const [treeVersion, setTreeVersion] = useState(0);
  const copiedTimer = useRef<number | null>(null);
  const debounceTimer = useRef<number | null>(null);
  const idleHandle = useRef<number | null>(null);
  const showGeneratorRef = useRef(false);
  const genLangRef = useRef<"ts" | "java" | "kt">("ts");
  const actionsRef = useRef<Record<string, () => void>>({});

  const focusStringSearch = useCallback(() => {
    const focus = () => {
      stringSearchRef.current?.focus();
      stringSearchRef.current?.select();
    };

    focus();
    window.requestAnimationFrame(focus);
    window.setTimeout(focus, 50);
  }, []);

  const parseState = useMemo(
    () => parseSource(debouncedSource),
    [debouncedSource],
  );

  const treeData = useMemo(() => {
    if (!parseState.valid) {
      return null;
    }
    return toTreeData(parseState.value);
  }, [parseState]);

  const normalizedStringSearch = useMemo(
    () => normalizeSearch(stringSearch),
    [stringSearch],
  );

  const stringSearchMatchCount = useMemo(() => {
    if (!treeData || !normalizedStringSearch) {
      return 0;
    }

    return countStringSearchMatches(treeData, normalizedStringSearch);
  }, [normalizedStringSearch, treeData]);

  const highlighted = useMemo(() => {
    if (!generated) {
      return "";
    }
    const lang =
      genLang === "ts" ? "typescript" : genLang === "java" ? "java" : "kotlin";
    return Prism.highlight(generated, Prism.languages[lang], lang);
  }, [generated, genLang]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) {
        window.clearTimeout(copiedTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (debounceTimer.current) {
      window.clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = window.setTimeout(() => {
      setDebouncedSource(source);
    }, 300);
    return () => {
      if (debounceTimer.current) {
        window.clearTimeout(debounceTimer.current);
      }
    };
  }, [source]);

  useEffect(() => {
    showGeneratorRef.current = showGenerator;
  }, [showGenerator]);

  useEffect(() => {
    genLangRef.current = genLang;
  }, [genLang]);

  useEffect(() => {
    getCurrentAppVersion()
      .then((version) => {
        setUpdateCheck((prev) => ({ ...prev, currentVersion: version }));
      })
      .catch(() => {
        setUpdateCheck((prev) => ({
          ...prev,
          currentVersion: __APP_VERSION__,
        }));
      });
  }, []);

  const scheduleIdleWork = (work: () => void) => {
    const w = window as Window &
      typeof globalThis & {
        requestIdleCallback?: (cb: () => void) => number;
        cancelIdleCallback?: (id: number) => void;
      };
    if (idleHandle.current !== null) {
      if (w.cancelIdleCallback) {
        w.cancelIdleCallback(idleHandle.current);
      } else {
        window.clearTimeout(idleHandle.current);
      }
    }
    if (w.requestIdleCallback) {
      idleHandle.current = w.requestIdleCallback(work);
    } else {
      idleHandle.current = window.setTimeout(work, 0);
    }
  };

  useEffect(() => {
    actionsRef.current = {
      file_open: handleOpen,
      file_save: handleSave,
      edit_search: focusStringSearch,
      edit_format: () => applyFormatted(indentSize),
      edit_minify: () => applyFormatted(),
      edit_validate: () => {
        const result = parseSource(source);
        setStatus(
          result.valid ? "JSON is valid" : `Invalid JSON: ${result.error}`,
        );
      },
      view_expand: handleExpandAll,
      view_collapse: handleCollapseAll,
      app_about: () => setShowAbout(true),
      app_check_updates: () => {
        setShowSettings(true);
        void handleCheckForUpdates();
      },
      app_settings: () => setShowSettings(true),
    };
  });

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return;
    }
    let unlisten: (() => void) | null = null;
    listen<string>("menu-action", (event) => {
      const action = event.payload;
      actionsRef.current[action]?.();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      const isSearchKey =
        event.code === "KeyF" || event.key.toLowerCase() === "f";

      if (!isSearchKey || (!event.metaKey && !event.ctrlKey)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      focusStringSearch();
    };

    const handleNativeSearchShortcut = () => {
      focusStringSearch();
    };

    window.addEventListener("keydown", handleSearchShortcut, true);
    window.addEventListener(
      "json-handle-focus-string-search",
      handleNativeSearchShortcut,
    );
    document.addEventListener("keydown", handleSearchShortcut, true);
    return () => {
      window.removeEventListener("keydown", handleSearchShortcut, true);
      window.removeEventListener(
        "json-handle-focus-string-search",
        handleNativeSearchShortcut,
      );
      document.removeEventListener("keydown", handleSearchShortcut, true);
    };
  }, [focusStringSearch]);

  const stats = useMemo(() => {
    if (!parseState.valid) {
      return {
        bytes: source.length,
        topLevel: "invalid",
      };
    }

    const value = parseState.value;
    const topLevel = Array.isArray(value)
      ? `array · ${value.length} items`
      : value === null
        ? "null"
        : typeof value === "object"
          ? `object · ${Object.keys(value).length} keys`
          : typeof value;

    return {
      bytes: source.length,
      topLevel,
    };
  }, [parseState, source.length]);

  const handleCopyPath = async (path: string) => {
    await navigator.clipboard.writeText(path);
    setStatus(`Copied path: ${path}`);
    if (copiedTimer.current) {
      window.clearTimeout(copiedTimer.current);
    }
    copiedTimer.current = window.setTimeout(() => setStatus("Ready"), 1600);
  };

  const handleSelect = (path: string, value: JsonValue) => {
    setSelectedPath(path);
    scheduleIdleWork(() => {
      setEditValue(
        typeof value === "string" ? value : JSON.stringify(value, null, 2),
      );
      if (showGeneratorRef.current) {
        setGenerated(generateFor(value, path, genLangRef.current));
      } else {
        setGenerated("");
      }
    });
  };

  const handleContextMenu = (
    event: React.MouseEvent<HTMLDivElement>,
    path: string,
    value: JsonValue,
  ) => {
    event.preventDefault();
    setSelectedPath(path);
    scheduleIdleWork(() => {
      setEditValue(
        typeof value === "string" ? value : JSON.stringify(value, null, 2),
      );
      if (showGeneratorRef.current) {
        setGenerated(generateFor(value, path, genLangRef.current));
      } else {
        setGenerated("");
      }
    });
    setContextMenu({ x: event.clientX, y: event.clientY, path, value });
  };

  const updateGenerated = useCallback(
    (lang: "ts" | "java" | "kt") => {
      if (!selectedPath || !parseState.valid) {
        setGenerated("");
        return;
      }
      const selectedValue = getJsonAtPath(parseState.value, selectedPath);
      if (selectedValue === null) {
        setGenerated("");
        return;
      }
      setGenerated(generateFor(selectedValue, selectedPath, lang));
    },
    [parseState.valid, parseState.value, selectedPath],
  );

  useEffect(() => {
    if (showGenerator && selectedPath) {
      updateGenerated(genLang);
    }
  }, [showGenerator, genLang, selectedPath, updateGenerated]);

  const handleApplyEdit = () => {
    if (!selectedPath) {
      setStatus("Select a node first");
      return;
    }
    if (!parseState.valid) {
      setStatus("Cannot edit while JSON is invalid");
      return;
    }
    try {
      const updated = JSON.parse(JSON.stringify(parseState.value)) as JsonValue;
      const parsedValue = JSON.parse(editValue);
      const path = selectedPath;
      const nextRoot = setJsonAtPath(updated, path, parsedValue);
      startTransition(() => {
        const next = JSON.stringify(nextRoot, null, 2);
        setSource(next);
        setDebouncedSource(next);
        setStatus(`Updated ${path}`);
      });
      setGenerated(generateFor(parsedValue, path, genLang));
    } catch (error) {
      setStatus(`Edit failed: ${formatError(error)}`);
    }
  };

  const handleUseLiteral = () => {
    if (!selectedPath) {
      setStatus("Select a node first");
      return;
    }
    if (!parseState.valid) {
      setStatus("Cannot edit while JSON is invalid");
      return;
    }
    const literal = editValue;
    try {
      const updated = JSON.parse(JSON.stringify(parseState.value)) as JsonValue;
      const path = selectedPath;
      const nextRoot = setJsonAtPath(updated, path, literal);
      startTransition(() => {
        const next = JSON.stringify(nextRoot, null, 2);
        setSource(next);
        setDebouncedSource(next);
        setStatus(`Updated ${path}`);
      });
      setGenerated(generateFor(literal as unknown as JsonValue, path, genLang));
    } catch (error) {
      setStatus(`Edit failed: ${formatError(error)}`);
    }
  };

  const applyFormatted = (indentation?: number) => {
    const current = editorRef.current?.value ?? source;
    const result = parseSource(current);
    if (!result.valid) {
      setStatus(`Cannot transform invalid JSON: ${result.error}`);
      return;
    }

    startTransition(() => {
      const next = JSON.stringify(result.value, null, indentation);
      setSource(next);
      setDebouncedSource(next);
      if (editorRef.current) {
        editorRef.current.value = next;
      }
      setStatus(indentation === undefined ? "JSON minified" : "JSON formatted");
    });
  };

  const handleOpen = async () => {
    try {
      if ("__TAURI_INTERNALS__" in window) {
        const [{ open }, { readTextFile }] = await Promise.all([
          import("@tauri-apps/plugin-dialog"),
          import("@tauri-apps/plugin-fs"),
        ]);
        const selected = await open({
          multiple: false,
          directory: false,
          filters: [{ name: "JSON", extensions: ["json", "txt"] }],
        });

        if (!selected || Array.isArray(selected)) {
          return;
        }

        const text = await readTextFile(selected);
        startTransition(() => {
          setSource(text);
          setDebouncedSource(text);
          if (editorRef.current) {
            editorRef.current.value = text;
          }
          setActiveFile(selected);
          setStatus(`Opened ${selected}`);
        });
        return;
      }

      const browserFile = await openFileFromBrowser();
      if (!browserFile) {
        return;
      }

      startTransition(() => {
        setSource(browserFile.text);
        setDebouncedSource(browserFile.text);
        if (editorRef.current) {
          editorRef.current.value = browserFile.text;
        }
        setActiveFile(browserFile.name);
        setStatus(`Opened ${browserFile.name}`);
      });
    } catch (error) {
      setStatus(`Open failed: ${formatError(error)}`);
    }
  };

  const handleSave = async () => {
    const current = editorRef.current?.value ?? source;
    const result = parseSource(current);
    if (!result.valid) {
      setStatus(`Cannot save invalid JSON: ${result.error}`);
      return;
    }

    const contents = JSON.stringify(result.value, null, indentSize);

    try {
      if ("__TAURI_INTERNALS__" in window) {
        const [{ save }, { writeTextFile }] = await Promise.all([
          import("@tauri-apps/plugin-dialog"),
          import("@tauri-apps/plugin-fs"),
        ]);
        const filePath =
          activeFile ??
          (await save({
            defaultPath: "data.json",
            filters: [{ name: "JSON", extensions: ["json"] }],
          }));

        if (!filePath || Array.isArray(filePath)) {
          return;
        }

        await writeTextFile(filePath, contents);
        setActiveFile(filePath);
        setStatus(`Saved ${filePath}`);
        return;
      }

      await saveFileFromBrowser(contents, "data.json");
      setStatus("Downloaded data.json");
    } catch (error) {
      setStatus(`Save failed: ${formatError(error)}`);
    }
  };

  const handleCheckForUpdates = async () => {
    setUpdateCheck((prev) => ({
      ...prev,
      status: "checking",
      message: "Checking GitHub Releases...",
    }));
    setStatus("Checking for updates...");

    try {
      const currentVersion = await getCurrentAppVersion();
      const response = await fetch(LATEST_RELEASE_API_URL, {
        headers: {
          Accept: "application/vnd.github+json",
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub returned ${response.status}`);
      }

      const release = (await response.json()) as GitHubRelease;
      const latestVersion = release.tag_name ?? release.name;

      if (!latestVersion) {
        throw new Error("Latest release did not include a version tag");
      }

      const releaseUrl = release.html_url ?? RELEASES_URL;
      const updateAvailable =
        compareVersions(latestVersion, currentVersion) > 0;
      const checkedAt = new Date().toLocaleString();
      const published = release.published_at
        ? ` Published ${new Date(release.published_at).toLocaleDateString()}.`
        : "";
      const message = updateAvailable
        ? `Version ${latestVersion} is available.${published}`
        : `You are on the latest version (${currentVersion}).${published}`;

      setUpdateCheck({
        status: updateAvailable ? "available" : "current",
        currentVersion,
        latestVersion,
        releaseUrl,
        checkedAt,
        message,
      });
      setStatus(
        updateAvailable
          ? `Update available: ${latestVersion}`
          : "App is up to date",
      );
    } catch (error) {
      const message = `Update check failed: ${formatError(error)}`;
      setUpdateCheck((prev) => ({
        ...prev,
        status: "error",
        checkedAt: new Date().toLocaleString(),
        message,
      }));
      setStatus(message);
    }
  };

  const handleCollapseAll = () => {
    setExpandAll(false);
    setSelectedPath(null);
    setTreeVersion((prev) => prev + 1);
    setStatus("Collapsed all nodes");
  };

  const handleExpandAll = () => {
    setExpandAll(true);
    setTreeVersion((prev) => prev + 1);
    setStatus("Expanded all nodes");
  };

  const handleDeleteNode = (path: string) => {
    if (!parseState.valid) {
      setStatus("Cannot delete while JSON is invalid");
      return;
    }
    if (path === "$") {
      setStatus("Root node cannot be deleted");
      return;
    }

    try {
      const updated = JSON.parse(JSON.stringify(parseState.value)) as JsonValue;
      const nextRoot = deleteJsonAtPath(updated, path);
      const next = JSON.stringify(nextRoot, null, 2);

      startTransition(() => {
        setSource(next);
        setDebouncedSource(next);
        if (editorRef.current) {
          editorRef.current.value = next;
        }
        if (
          selectedPath === path ||
          selectedPath?.startsWith(`${path}.`) ||
          selectedPath?.startsWith(`${path}[`)
        ) {
          setSelectedPath(null);
          setEditValue("");
          setGenerated("");
        }
        setStatus(`Deleted ${path}`);
      });
    } catch (error) {
      setStatus(`Delete failed: ${formatError(error)}`);
    } finally {
      setContextMenu(null);
    }
  };

  const renderTreeItem = ({
    item,
    level,
    isSelected,
  }: TreeRenderItemParams) => {
    const meta = item as JsonTreeItem;
    const isStringSearchMatch = stringValueMatches(
      meta.value,
      normalizedStringSearch,
    );
    const summaryClass = (() => {
      if (meta.value === null) return "text-slate-500";
      if (Array.isArray(meta.value)) return "text-blue-600";
      switch (typeof meta.value) {
        case "string":
          return "text-orange-600";
        case "number":
          return "text-rose-600";
        case "boolean":
          return "text-slate-600";
        case "object":
          return "text-emerald-600";
        default:
          return "text-muted-foreground";
      }
    })();
    return (
      <div
        className={cn(
          "grid w-full grid-cols-[minmax(120px,1fr)_auto] items-center gap-2 text-left relative rounded-md px-1.5 py-1",
          isSelected && "bg-accent text-accent-foreground",
          !isSelected &&
            isStringSearchMatch &&
            "bg-amber-50 ring-1 ring-amber-200",
          level > 0 &&
            "before:absolute before:-left-3 before:top-1/2 before:h-[1px] before:w-3 before:border-t before:border-dashed before:border-border/70",
        )}
        onContextMenu={(event) =>
          handleContextMenu(event, meta.path, meta.value)
        }
      >
        <span
          className={cn(
            "text-xs font-semibold truncate",
            isSelected ? "text-foreground" : "text-foreground/90",
          )}
        >
          {meta.label}
        </span>
        <span
          className={cn(
            "min-w-0 text-xs",
            isStringSearchMatch
              ? "max-w-[28rem] whitespace-normal break-all"
              : "truncate",
            summaryClass,
          )}
        >
          {typeof meta.value === "string"
            ? highlightText(meta.summary, normalizedStringSearch)
            : meta.summary}
        </span>
      </div>
    );
  };

  return (
    <main
      className="flex h-full flex-col gap-4 p-4"
      onClick={() => setContextMenu(null)}
    >
      <section className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2 h-0">
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardDescription className="uppercase tracking-[0.25em] text-[11px]">
                Source
              </CardDescription>
              <CardTitle>Raw editor</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => applyFormatted(indentSize)}
              >
                <FontAwesomeIcon icon={faWandMagicSparkles} />
                Format
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => applyFormatted()}
              >
                <FontAwesomeIcon icon={faCompress} />
                Minify
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            <Textarea
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              data-gramm="false"
              data-gramm_editor="false"
              aria-label="JSON source"
              className="min-h-0 flex-1 resize-none font-mono text-sm leading-6"
              value={source}
              onChange={(event) => setSource(event.currentTarget.value)}
              spellCheck={false}
              ref={editorRef}
            />
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardDescription className="uppercase tracking-[0.25em] text-[11px]">
                Inspect
              </CardDescription>
              <CardTitle>Tree view</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => selectedPath && handleCopyPath(selectedPath)}
              >
                <FontAwesomeIcon icon={faCopy} />
                Copy path
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowGenerator(true)}
              >
                <FontAwesomeIcon icon={faCodeBranch} />
                Generate
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 min-h-0 flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <FontAwesomeIcon
                  icon={faMagnifyingGlass}
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  ref={stringSearchRef}
                  value={stringSearch}
                  onChange={(event) => setStringSearch(event.target.value)}
                  className="h-8 pl-8 pr-3 font-mono text-xs"
                  placeholder="搜索字符串值"
                  aria-label="Search string values"
                />
              </div>
              {normalizedStringSearch ? (
                <>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {stringSearchMatchCount} matches
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStringSearch("")}
                    aria-label="Clear string search"
                  >
                    <FontAwesomeIcon icon={faCircleXmark} />
                    Clear
                  </Button>
                </>
              ) : null}
            </div>
            <div className="flex-[2] min-h-0 overflow-hidden rounded-md border border-border bg-background p-2 font-mono text-[12px]">
              {parseState.valid && treeData ? (
                <TreeView
                  key={`tree-${treeVersion}-${expandAll ? "all" : "none"}`}
                  data={treeData}
                  expandAll={expandAll}
                  className="h-full overflow-auto"
                  initialSelectedItemId={selectedPath ?? undefined}
                  onSelectChange={(item) => {
                    if (!item) return;
                    const meta = item as JsonTreeItem;
                    handleSelect(meta.path, meta.value);
                  }}
                  renderItem={renderTreeItem}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  当前内容还不是合法
                  JSON。修复左侧解析错误后，这里会自动渲染树结构。
                </div>
              )}
            </div>

            <div className="flex-[1] min-h-0 rounded-md border border-border bg-muted/40 p-3 flex flex-col">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                    Edit node
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {selectedPath ?? "Select a node in tree"}
                  </div>
                </div>
              </div>
              <Textarea
                className="mt-2 flex-1 min-h-0 font-mono text-xs leading-5"
                spellCheck={false}
                placeholder='Edit value here. For strings, use quotes: "text".'
                value={editValue}
                onChange={(event) => setEditValue(event.target.value)}
              />
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" onClick={handleApplyEdit}>
                  Apply (JSON)
                </Button>
                <Button size="sm" variant="outline" onClick={handleUseLiteral}>
                  Apply as string
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate whitespace-nowrap">
            {parseState.valid ? status : parseState.error}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          <Badge
            className={cn(
              "gap-2 rounded-full border px-3 py-1 text-[11px]",
              parseState.valid
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-700",
            )}
          >
            <FontAwesomeIcon
              icon={parseState.valid ? faCheckCircle : faCircleXmark}
            />
            {parseState.valid ? "Valid" : "Invalid"}
          </Badge>
          <span>{stats.topLevel}</span>
          <span>{stats.bytes} chars</span>
          <span>{activeFile ?? "Unsaved buffer"}</span>
        </div>
      </section>

      <Dialog open={showGenerator} onOpenChange={setShowGenerator}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogDescription className="uppercase tracking-[0.25em] text-[11px]">
              Generate
            </DialogDescription>
            <DialogTitle>Type structures</DialogTitle>
          </DialogHeader>
          <Tabs
            value={genLang}
            onValueChange={(value) => {
              const next = value as "ts" | "java" | "kt";
              setGenLang(next);
              updateGenerated(next);
            }}
          >
            <TabsList>
              <TabsTrigger value="ts">TypeScript</TabsTrigger>
              <TabsTrigger value="java">Java</TabsTrigger>
              <TabsTrigger value="kt">Kotlin</TabsTrigger>
            </TabsList>
            <TabsContent value={genLang}>
              <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
                <pre className="prism-output max-h-[50vh] overflow-auto text-xs">
                  <code
                    className={`language-${genLang}`}
                    dangerouslySetInnerHTML={{
                      __html: highlighted || "Select a node to generate types.",
                    }}
                  />
                </pre>
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(generated || "");
              }}
            >
              Copy
            </Button>
            <Button onClick={() => setShowGenerator(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAbout} onOpenChange={setShowAbout}>
        <DialogContent>
          <DialogHeader>
            <DialogDescription className="uppercase tracking-[0.25em] text-[11px]">
              About
            </DialogDescription>
            <DialogTitle>JSON Handle</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3">
              <img
                src="/app-icon.png"
                alt=""
                className="h-12 w-12 rounded-md"
                draggable={false}
              />
              <div className="min-w-0">
                <div className="text-sm font-semibold">JSON Handle</div>
                <div className="text-xs text-muted-foreground">
                  Version {updateCheck.currentVersion}
                </div>
                <div className="text-xs text-muted-foreground">
                  Copyright © {new Date().getFullYear()} chaibai.com.cn
                </div>
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              A local macOS JSON tool for formatting, validation, tree
              inspection, node editing, and type generation.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void openExternalUrl(PROJECT_URL)}
              >
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                Project Page
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void openExternalUrl(RELEASES_URL)}
              >
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                Releases
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setShowAbout(false);
                  setShowSettings(true);
                }}
              >
                Check Updates
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowAbout(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent>
          <DialogHeader>
            <DialogDescription className="uppercase tracking-[0.25em] text-[11px]">
              Settings
            </DialogDescription>
            <DialogTitle>Preferences</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 p-3">
            <div>
              <div className="text-sm font-semibold">Indent size</div>
              <div className="text-xs text-muted-foreground">
                Used for format and save.
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={indentSize === 2 ? "default" : "outline"}
                onClick={() => setIndentSize(2)}
              >
                2 spaces
              </Button>
              <Button
                size="sm"
                variant={indentSize === 4 ? "default" : "outline"}
                onClick={() => setIndentSize(4)}
              >
                4 spaces
              </Button>
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">Version updates</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Current version {updateCheck.currentVersion}
                  {updateCheck.latestVersion
                    ? ` · Latest ${updateCheck.latestVersion}`
                    : ""}
                </div>
              </div>
              <Badge
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-[11px]",
                  updateCheck.status === "available" &&
                    "border-blue-200 bg-blue-50 text-blue-700",
                  updateCheck.status === "current" &&
                    "border-emerald-200 bg-emerald-50 text-emerald-700",
                  updateCheck.status === "error" &&
                    "border-rose-200 bg-rose-50 text-rose-700",
                  (updateCheck.status === "idle" ||
                    updateCheck.status === "checking") &&
                    "border-slate-200 bg-slate-50 text-slate-700",
                )}
              >
                {updateCheck.status === "checking"
                  ? "Checking"
                  : updateCheck.status === "available"
                    ? "Update available"
                    : updateCheck.status === "current"
                      ? "Up to date"
                      : updateCheck.status === "error"
                        ? "Failed"
                        : "Not checked"}
              </Badge>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {updateCheck.message}
            </div>
            {updateCheck.checkedAt ? (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Checked at {updateCheck.checkedAt}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => void handleCheckForUpdates()}
                disabled={updateCheck.status === "checking"}
              >
                <FontAwesomeIcon icon={faRotate} />
                Check for Updates
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void openExternalUrl(updateCheck.releaseUrl)}
              >
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                Open Download Page
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowSettings(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {contextMenu ? (
        <div
          className="fixed z-50 w-44 rounded-md border border-border bg-card p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              handleCopyPath(contextMenu.path);
              setContextMenu(null);
            }}
          >
            Copy path
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={async () => {
              await navigator.clipboard.writeText(
                typeof contextMenu.value === "string"
                  ? contextMenu.value
                  : JSON.stringify(contextMenu.value, null, 2),
              );
              setStatus("Copied value");
              setContextMenu(null);
            }}
          >
            Copy value
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              setShowGenerator(true);
              setContextMenu(null);
            }}
          >
            Generate code
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            onClick={() => handleDeleteNode(contextMenu.path)}
          >
            Delete node
          </Button>
        </div>
      ) : null}
    </main>
  );
}

export default App;

function generateFor(
  value: JsonValue,
  path: string,
  lang: "ts" | "java" | "kt",
) {
  const name = nameFromPath(path);
  if (lang === "ts") {
    return generateTypeScript(value, name);
  }
  if (lang === "java") {
    return generateJava(value, name);
  }
  return generateKotlin(value, name);
}

function nameFromPath(path: string) {
  if (path === "$") {
    return "Root";
  }
  const segs = pathToSegments(path);
  const last = segs[segs.length - 1] || "Value";
  return toPascalCase(last.replace(/\d+/g, "Item"));
}

function toPascalCase(input: string) {
  return input
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function generateTypeScript(value: JsonValue, rootName: string) {
  const defs: string[] = [];
  const visited = new Map<JsonValue, string>();

  const typeOf = (val: JsonValue, name: string): string => {
    if (val === null) return "null";
    if (typeof val === "string") return "string";
    if (typeof val === "number") return "number";
    if (typeof val === "boolean") return "boolean";
    if (Array.isArray(val)) {
      if (val.length === 0) return "unknown[]";
      return `${typeOf(val[0], `${name}Item`)}[]`;
    }
    if (visited.has(val)) return visited.get(val) as string;
    const typeName = toPascalCase(name);
    visited.set(val, typeName);
    const lines = Object.entries(val).map(
      ([key, child]) =>
        `  ${key}: ${typeOf(child, `${typeName}${toPascalCase(key)}`)};`,
    );
    defs.push(`export interface ${typeName} {\n${lines.join("\n")}\n}`);
    return typeName;
  };

  typeOf(value, rootName);
  return defs.join("\n\n");
}

function generateJava(value: JsonValue, rootName: string) {
  const defs: string[] = [];
  const visited = new Map<JsonValue, string>();

  const typeOf = (val: JsonValue, name: string): string => {
    if (val === null) return "Object";
    if (typeof val === "string") return "String";
    if (typeof val === "number") return "Double";
    if (typeof val === "boolean") return "Boolean";
    if (Array.isArray(val)) {
      if (val.length === 0) return "List<Object>";
      return `List<${typeOf(val[0], `${name}Item`)}>`;
    }
    if (visited.has(val)) return visited.get(val) as string;
    const typeName = toPascalCase(name);
    visited.set(val, typeName);
    const lines = Object.entries(val).map(
      ([key, child]) =>
        `    ${typeOf(child, `${typeName}${toPascalCase(key)}`)} ${key}();`,
    );
    defs.push(`public interface ${typeName} {\n${lines.join("\n")}\n}`);
    return typeName;
  };

  typeOf(value, rootName);
  return `import java.util.List;\n\n${defs.join("\n\n")}`;
}

function generateKotlin(value: JsonValue, rootName: string) {
  const defs: string[] = [];
  const visited = new Map<JsonValue, string>();

  const typeOf = (val: JsonValue, name: string): string => {
    if (val === null) return "Any?";
    if (typeof val === "string") return "String";
    if (typeof val === "number") return "Double";
    if (typeof val === "boolean") return "Boolean";
    if (Array.isArray(val)) {
      if (val.length === 0) return "List<Any>";
      return `List<${typeOf(val[0], `${name}Item`)}>`;
    }
    if (visited.has(val)) return visited.get(val) as string;
    const typeName = toPascalCase(name);
    visited.set(val, typeName);
    const lines = Object.entries(val).map(
      ([key, child]) =>
        `  val ${key}: ${typeOf(child, `${typeName}${toPascalCase(key)}`)}`,
    );
    defs.push(`data class ${typeName}(\n${lines.join(",\n")}\n)`);
    return typeName;
  };

  typeOf(value, rootName);
  return defs.join("\n\n");
}
