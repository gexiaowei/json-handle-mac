import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCheckCircle,
  faChevronDown,
  faChevronRight,
  faCompress,
  faFloppyDisk,
  faFolderOpen,
  faMinus,
  faPlus,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons'
import './App.css'

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

type ParseState =
  | { valid: true; value: JsonValue; error: null }
  | { valid: false; value: null; error: string }

type TreeNodeProps = {
  label: string
  value: JsonValue
  path: string
  depth: number
  collapsed: Set<string>
  onToggle: (path: string) => void
  onCopyPath: (path: string) => void
  onSelect: (path: string, value: JsonValue) => void
}

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
}`

function formatError(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown parsing error'
}

function parseSource(source: string): ParseState {
  if (!source.trim()) {
    return { valid: false, value: null, error: 'Paste or open a JSON document to begin.' }
  }

  try {
    return {
      valid: true,
      value: JSON.parse(source) as JsonValue,
      error: null,
    }
  } catch (error) {
    return {
      valid: false,
      value: null,
      error: formatError(error),
    }
  }
}

function isContainer(value: JsonValue): value is JsonValue[] | Record<string, JsonValue> {
  return typeof value === 'object' && value !== null
}

function summarize(value: JsonValue) {
  if (Array.isArray(value)) {
    return `Array(${value.length})`
  }
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'object') {
    return `Object(${Object.keys(value).length})`
  }
  return JSON.stringify(value)
}

function collectContainerPaths(value: JsonValue, path = '$') {
  const paths: string[] = []

  if (!isContainer(value)) {
    return paths
  }

  paths.push(path)

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      paths.push(...collectContainerPaths(item, `${path}[${index}]`))
    })
  } else {
    Object.entries(value).forEach(([key, child]) => {
      paths.push(...collectContainerPaths(child, `${path}.${key}`))
    })
  }

  return paths
}

function TreeNode({
  label,
  value,
  path,
  depth,
  collapsed,
  onToggle,
  onCopyPath,
  onSelect,
}: TreeNodeProps) {
  const container = isContainer(value)
  const isCollapsed = container && collapsed.has(path)
  const indent = { paddingLeft: `${depth * 18}px` }

  return (
    <div className="tree-node">
      <div className="tree-row" style={indent}>
        {container ? (
          <button className="icon-btn tree-toggle" onClick={() => onToggle(path)} type="button">
            <FontAwesomeIcon icon={isCollapsed ? faChevronRight : faChevronDown} />
          </button>
        ) : (
          <span className="tree-spacer" />
        )}
        <button
          className="tree-path"
          onClick={() => onSelect(path, value)}
          onDoubleClick={() => onCopyPath(path)}
          type="button"
        >
          <span className="tree-label">{label}</span>
          <span className="tree-summary">{summarize(value)}</span>
        </button>
      </div>

      {container && !isCollapsed ? (
        <div>
          {Array.isArray(value)
            ? value.map((item, index) => (
                <TreeNode
                  key={`${path}[${index}]`}
                  label={`[${index}]`}
                  value={item}
                  path={`${path}[${index}]`}
                  depth={depth + 1}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  onCopyPath={onCopyPath}
                  onSelect={onSelect}
                />
              ))
            : Object.entries(value).map(([key, child]) => (
                <TreeNode
                  key={`${path}.${key}`}
                  label={key}
                  value={child}
                  path={`${path}.${key}`}
                  depth={depth + 1}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  onCopyPath={onCopyPath}
                  onSelect={onSelect}
                />
              ))}
        </div>
      ) : null}
    </div>
  )
}

async function openFileFromBrowser() {
  return new Promise<{ text: string; name: string } | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json,.txt'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }

      resolve({ text: await file.text(), name: file.name })
    }
    input.click()
  })
}

async function saveFileFromBrowser(contents: string, fallbackName: string) {
  const blob = new Blob([contents], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fallbackName
  anchor.click()
  URL.revokeObjectURL(url)
}

function App() {
  const [source, setSource] = useState(sampleJson)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState('Ready')
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const deferredSource = useDeferredValue(source)
  const copiedTimer = useRef<number | null>(null)

  const parseState = useMemo(() => parseSource(deferredSource), [deferredSource])

  useEffect(() => {
    return () => {
      if (copiedTimer.current) {
        window.clearTimeout(copiedTimer.current)
      }
    }
  }, [])

  const stats = useMemo(() => {
    if (!parseState.valid) {
      return {
        bytes: source.length,
        topLevel: 'invalid',
      }
    }

    const value = parseState.value
    const topLevel = Array.isArray(value)
      ? `array · ${value.length} items`
      : value === null
        ? 'null'
        : typeof value === 'object'
          ? `object · ${Object.keys(value).length} keys`
          : typeof value

    return {
      bytes: source.length,
      topLevel,
    }
  }, [parseState, source.length])

  const handleToggle = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const handleCopyPath = async (path: string) => {
    await navigator.clipboard.writeText(path)
    setCopiedPath(path)
    setStatus(`Copied path: ${path}`)
    if (copiedTimer.current) {
      window.clearTimeout(copiedTimer.current)
    }
    copiedTimer.current = window.setTimeout(() => setCopiedPath(null), 1600)
  }

  const handleSelect = (path: string, value: JsonValue) => {
    setSelectedPath(path)
    setEditValue(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  }

  const handleApplyEdit = () => {
    if (!selectedPath) {
      setStatus('Select a node first')
      return
    }
    if (!parseState.valid) {
      setStatus('Cannot edit while JSON is invalid')
      return
    }
    try {
      const updated = JSON.parse(JSON.stringify(parseState.value)) as JsonValue
      const parsedValue = JSON.parse(editValue)
      const path = selectedPath
      if (path === '$') {
        startTransition(() => {
          setSource(JSON.stringify(parsedValue, null, 2))
          setStatus(`Updated ${path}`)
        })
        return
      }
      let cursor: any = updated
      const segments = path
        .slice(2)
        .split('.')
        .flatMap((seg) => {
          const parts: string[] = []
          let current = ''
          for (let i = 0; i < seg.length; i += 1) {
            const char = seg[i]
            if (char === '[') {
              if (current) {
                parts.push(current)
                current = ''
              }
              const close = seg.indexOf(']', i)
              parts.push(seg.slice(i, close + 1))
              i = close
            } else {
              current += char
            }
          }
          if (current) {
            parts.push(current)
          }
          return parts.filter(Boolean)
        })
        .filter(Boolean)
      for (let i = 0; i < segments.length - 1; i += 1) {
        const key = segments[i]
        if (key.startsWith('[') && key.endsWith(']')) {
          const index = Number(key.slice(1, -1))
          cursor = cursor[index]
        } else {
          cursor = cursor[key]
        }
      }
      const last = segments[segments.length - 1]
      if (last.startsWith('[') && last.endsWith(']')) {
        const index = Number(last.slice(1, -1))
        cursor[index] = parsedValue
      } else {
        cursor[last] = parsedValue
      }
      startTransition(() => {
        setSource(JSON.stringify(updated, null, 2))
        setStatus(`Updated ${path}`)
      })
    } catch (error) {
      setStatus(`Edit failed: ${formatError(error)}`)
    }
  }

  const handleUseLiteral = () => {
    if (!selectedPath) {
      setStatus('Select a node first')
      return
    }
    if (!parseState.valid) {
      setStatus('Cannot edit while JSON is invalid')
      return
    }
    const literal = editValue
    try {
      const updated = JSON.parse(JSON.stringify(parseState.value)) as JsonValue
      const path = selectedPath
      const parsedValue = literal
      if (path === '$') {
        startTransition(() => {
          setSource(JSON.stringify(parsedValue, null, 2))
          setStatus(`Updated ${path}`)
        })
        return
      }
      let cursor: any = updated
      const segments = path
        .slice(2)
        .split('.')
        .flatMap((seg) => {
          const parts: string[] = []
          let current = ''
          for (let i = 0; i < seg.length; i += 1) {
            const char = seg[i]
            if (char === '[') {
              if (current) {
                parts.push(current)
                current = ''
              }
              const close = seg.indexOf(']', i)
              parts.push(seg.slice(i, close + 1))
              i = close
            } else {
              current += char
            }
          }
          if (current) {
            parts.push(current)
          }
          return parts.filter(Boolean)
        })
        .filter(Boolean)
      for (let i = 0; i < segments.length - 1; i += 1) {
        const key = segments[i]
        if (key.startsWith('[') && key.endsWith(']')) {
          const index = Number(key.slice(1, -1))
          cursor = cursor[index]
        } else {
          cursor = cursor[key]
        }
      }
      const last = segments[segments.length - 1]
      if (last.startsWith('[') && last.endsWith(']')) {
        const index = Number(last.slice(1, -1))
        cursor[index] = parsedValue
      } else {
        cursor[last] = parsedValue
      }
      startTransition(() => {
        setSource(JSON.stringify(updated, null, 2))
        setStatus(`Updated ${path}`)
      })
    } catch (error) {
      setStatus(`Edit failed: ${formatError(error)}`)
    }
  }

  const applyFormatted = (indentation?: number) => {
    const result = parseSource(source)
    if (!result.valid) {
      setStatus(`Cannot transform invalid JSON: ${result.error}`)
      return
    }

    startTransition(() => {
      setSource(JSON.stringify(result.value, null, indentation))
      setStatus(indentation === undefined ? 'JSON minified' : 'JSON formatted')
    })
  }

  const handleOpen = async () => {
    try {
      if ('__TAURI_INTERNALS__' in window) {
        const [{ open }, { readTextFile }] = await Promise.all([
          import('@tauri-apps/plugin-dialog'),
          import('@tauri-apps/plugin-fs'),
        ])
        const selected = await open({
          multiple: false,
          directory: false,
          filters: [{ name: 'JSON', extensions: ['json', 'txt'] }],
        })

        if (!selected || Array.isArray(selected)) {
          return
        }

        const text = await readTextFile(selected)
        startTransition(() => {
          setSource(text)
          setActiveFile(selected)
          setCollapsed(new Set())
          setStatus(`Opened ${selected}`)
        })
        return
      }

      const browserFile = await openFileFromBrowser()
      if (!browserFile) {
        return
      }

      startTransition(() => {
        setSource(browserFile.text)
        setActiveFile(browserFile.name)
        setCollapsed(new Set())
        setStatus(`Opened ${browserFile.name}`)
      })
    } catch (error) {
      setStatus(`Open failed: ${formatError(error)}`)
    }
  }

  const handleSave = async () => {
    const result = parseSource(source)
    if (!result.valid) {
      setStatus(`Cannot save invalid JSON: ${result.error}`)
      return
    }

    const contents = JSON.stringify(result.value, null, 2)

    try {
      if ('__TAURI_INTERNALS__' in window) {
        const [{ save }, { writeTextFile }] = await Promise.all([
          import('@tauri-apps/plugin-dialog'),
          import('@tauri-apps/plugin-fs'),
        ])
        const filePath =
          activeFile ??
          (await save({
            defaultPath: 'data.json',
            filters: [{ name: 'JSON', extensions: ['json'] }],
          }))

        if (!filePath || Array.isArray(filePath)) {
          return
        }

        await writeTextFile(filePath, contents)
        setActiveFile(filePath)
        setStatus(`Saved ${filePath}`)
        return
      }

      await saveFileFromBrowser(contents, 'data.json')
      setStatus('Downloaded data.json')
    } catch (error) {
      setStatus(`Save failed: ${formatError(error)}`)
    }
  }

  const handleCollapseAll = () => {
    if (!parseState.valid) {
      return
    }
    setCollapsed(new Set(collectContainerPaths(parseState.value).filter((path) => path !== '$')))
    setStatus('Collapsed all nested nodes')
  }

  const handleExpandAll = () => {
    setCollapsed(new Set())
    setStatus('Expanded all nodes')
  }

  return (
    <main className="app-shell">
     

      <section className="toolbar">
        <div className="toolbar-group">
          <button onClick={handleOpen} type="button">
            <FontAwesomeIcon icon={faFolderOpen} />
            Open
          </button>
          <button onClick={handleSave} type="button">
            <FontAwesomeIcon icon={faFloppyDisk} />
            Save
          </button>
        </div>
        <div className="toolbar-group">
          <button onClick={() => applyFormatted(2)} type="button">
            <FontAwesomeIcon icon={faWandMagicSparkles} />
            Format
          </button>
          <button onClick={() => applyFormatted()} type="button">
            <FontAwesomeIcon icon={faCompress} />
            Minify
          </button>
          <button
            onClick={() =>
              setStatus(parseState.valid ? 'JSON is valid' : `Invalid JSON: ${parseState.error}`)
            }
            type="button"
          >
            <FontAwesomeIcon icon={faCheckCircle} />
            Validate
          </button>
        </div>
        <div className="toolbar-group">
          <button onClick={handleExpandAll} type="button">
            <FontAwesomeIcon icon={faPlus} />
            Expand all
          </button>
          <button onClick={handleCollapseAll} type="button">
            <FontAwesomeIcon icon={faMinus} />
            Collapse all
          </button>
        </div>
      </section>

      <section className="workspace">
        <article className="panel editor-panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Source</p>
              <h2>Raw editor</h2>
            </div>
            <span className={`badge ${parseState.valid ? 'ok' : 'error'}`}>
              {parseState.valid ? 'Valid JSON' : 'Parse error'}
            </span>
          </div>
          <textarea
            aria-label="JSON source"
            className="json-input"
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            value={source}
          />
          <p className="status-line">{parseState.valid ? status : parseState.error}</p>
        </article>

        <article className="panel tree-panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Inspect</p>
              <h2>Tree view</h2>
            </div>
            <span className="panel-note">
              {copiedPath ? `Copied ${copiedPath}` : 'Click a row to copy its path'}
            </span>
          </div>
          <div className="tree-scroll">
            {parseState.valid ? (
              <TreeNode
                label="$"
                value={parseState.value}
                path="$"
                depth={0}
                collapsed={collapsed}
                onToggle={handleToggle}
                onCopyPath={handleCopyPath}
                onSelect={handleSelect}
              />
            ) : (
              <div className="empty-state">
                <p>当前内容还不是合法 JSON。</p>
                <p>修复左侧解析错误后，这里会自动渲染树结构。</p>
              </div>
            )}
          </div>
          <div className="editor-inline">
            <div>
              <p className="panel-kicker">Edit node</p>
              <p className="editor-path">{selectedPath ?? 'Select a node in tree'}</p>
            </div>
            <textarea
              className="editor-input"
              spellCheck={false}
              placeholder='Edit value here. For strings, use quotes: "text".'
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
            />
            <div className="editor-actions">
              <button type="button" onClick={handleApplyEdit}>
                Apply (JSON)
              </button>
              <button type="button" className="subtle" onClick={handleUseLiteral}>
                Apply as string
              </button>
            </div>
          </div>
        </article>
      </section>
      <section className="hero-panel">
        <div className="hero-meta">
          <span>{stats.topLevel}</span>
          <span>{stats.bytes} chars</span>
          <span>{activeFile ?? 'Unsaved buffer'}</span>
        </div>
      </section>
    </main>
  )
}

export default App
