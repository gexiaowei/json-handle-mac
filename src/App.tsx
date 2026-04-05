import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheckCircle, faCircleXmark } from '@fortawesome/free-solid-svg-icons'
import { listen } from '@tauri-apps/api/event'
import Prism from 'prismjs'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-kotlin'
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
  selectedPath: string | null
  onToggle: (path: string) => void
  onCopyPath: (path: string) => void
  onSelect: (path: string, value: JsonValue) => void
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>, path: string, value: JsonValue) => void
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

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function pathToSegments(path: string) {
  if (path === '$') {
    return []
  }
  return path
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
          parts.push(seg.slice(i + 1, close))
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
}

function setJsonAtPath(root: JsonValue, path: string, nextValue: JsonValue) {
  if (path === '$') {
    return nextValue
  }
  const updated = root
  const segments = pathToSegments(path)
  let cursor: JsonValue = updated
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]
    const index = Number(key)
    if (Number.isNaN(index)) {
      if (!isJsonObject(cursor)) {
        return updated
      }
      cursor = cursor[key]
    } else {
      if (!Array.isArray(cursor)) {
        return updated
      }
      cursor = cursor[index]
    }
  }
  const last = segments[segments.length - 1]
  const lastIndex = Number(last)
  if (Number.isNaN(lastIndex)) {
    if (!isJsonObject(cursor)) {
      return updated
    }
    cursor[last] = nextValue
  } else {
    if (!Array.isArray(cursor)) {
      return updated
    }
    cursor[lastIndex] = nextValue
  }
  return updated as JsonValue
}

function getJsonAtPath(root: JsonValue, path: string): JsonValue | null {
  if (path === '$') {
    return root
  }
  const segments = pathToSegments(path)
  let cursor: JsonValue = root
  for (const seg of segments) {
    const index = Number(seg)
    if (Number.isNaN(index)) {
      if (!isJsonObject(cursor)) {
        return null
      }
      cursor = cursor[seg]
    } else {
      if (!Array.isArray(cursor)) {
        return null
      }
      cursor = cursor[index]
    }
    if (cursor === undefined) {
      return null
    }
  }
  return cursor
}

function TreeNode({
  label,
  value,
  path,
  depth,
  collapsed,
  selectedPath,
  onToggle,
  onCopyPath,
  onSelect,
  onContextMenu,
}: TreeNodeProps) {
  const container = isContainer(value)
  const isCollapsed = container && collapsed.has(path)
  const isSelected = selectedPath === path
  const rowClass = `tree-row ${depth === 0 ? 'root' : 'nested'}`

  return (
    <div className="tree-node">
      <div className={rowClass}>
        {container ? (
          <button className="tree-toggle" onClick={() => onToggle(path)} type="button">
            {isCollapsed ? '+' : '−'}
          </button>
        ) : null}
        <button
          className={`tree-path ${isSelected ? 'selected' : ''}`}
          onClick={() => onSelect(path, value)}
          onContextMenu={(event) => onContextMenu(event, path, value)}
          type="button"
        >
          <span className="tree-label">{depth === 0 ? 'root' : label}</span>
          <span className={`tree-summary ${typeClass(value)}`}>{summarize(value)}</span>
        </button>
      </div>

      {container && !isCollapsed ? (
        <div className="tree-children">
          {Array.isArray(value)
            ? value.map((item, index) => (
                <TreeNode
                  key={`${path}[${index}]`}
                  label={`[${index}]`}
                  value={item}
                  path={`${path}[${index}]`}
                  depth={depth + 1}
                  collapsed={collapsed}
                  selectedPath={selectedPath}
                  onToggle={onToggle}
                  onCopyPath={onCopyPath}
                  onSelect={onSelect}
                  onContextMenu={onContextMenu}
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
                  selectedPath={selectedPath}
                  onToggle={onToggle}
                  onCopyPath={onCopyPath}
                  onSelect={onSelect}
                  onContextMenu={onContextMenu}
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
  const [, setCopiedPath] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [indentSize, setIndentSize] = useState<2 | 4>(2)
  const [genLang, setGenLang] = useState<'ts' | 'java' | 'kt'>('ts')
  const [generated, setGenerated] = useState('')
  const [showGenerator, setShowGenerator] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    path: string
    value: JsonValue
  } | null>(null)
  const deferredSource = useDeferredValue(source)
  const copiedTimer = useRef<number | null>(null)
  const actionsRef = useRef<Record<string, () => void>>({})

  const parseState = useMemo(() => parseSource(deferredSource), [deferredSource])
  const highlighted = useMemo(() => {
    if (!generated) {
      return ''
    }
    const lang =
      genLang === 'ts' ? 'typescript' : genLang === 'java' ? 'java' : 'kotlin'
    return Prism.highlight(generated, Prism.languages[lang], lang)
  }, [generated, genLang])

  useEffect(() => {
    return () => {
      if (copiedTimer.current) {
        window.clearTimeout(copiedTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    actionsRef.current = {
      file_open: handleOpen,
      file_save: handleSave,
      edit_format: () => applyFormatted(indentSize),
      edit_minify: () => applyFormatted(),
      edit_validate: () =>
        setStatus(parseState.valid ? 'JSON is valid' : `Invalid JSON: ${parseState.error}`),
      view_expand: handleExpandAll,
      view_collapse: handleCollapseAll,
      app_settings: () => setShowSettings(true),
    }
  })

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) {
      return
    }
    let unlisten: (() => void) | null = null
    listen<string>('menu-action', (event) => {
      const action = event.payload
      actionsRef.current[action]?.()
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
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
    setGenerated(generateFor(value, path, genLang))
  }

  const handleContextMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    path: string,
    value: JsonValue
  ) => {
    event.preventDefault()
    setSelectedPath(path)
    setEditValue(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    setGenerated(generateFor(value, path, genLang))
    setContextMenu({ x: event.clientX, y: event.clientY, path, value })
  }

  const updateGenerated = (lang: 'ts' | 'java' | 'kt') => {
    if (!selectedPath || !parseState.valid) {
      setGenerated('')
      return
    }
    const selectedValue = getJsonAtPath(parseState.value, selectedPath)
    if (selectedValue === null) {
      setGenerated('')
      return
    }
    setGenerated(generateFor(selectedValue, selectedPath, lang))
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
      const nextRoot = setJsonAtPath(updated, path, parsedValue)
      startTransition(() => {
        setSource(JSON.stringify(nextRoot, null, 2))
        setStatus(`Updated ${path}`)
      })
      setGenerated(generateFor(parsedValue, path, genLang))
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
      const nextRoot = setJsonAtPath(updated, path, literal)
      startTransition(() => {
        setSource(JSON.stringify(nextRoot, null, 2))
        setStatus(`Updated ${path}`)
      })
      setGenerated(generateFor(literal as unknown as JsonValue, path, genLang))
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

    const contents = JSON.stringify(result.value, null, indentSize)

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
    <main className="app-shell" onClick={() => setContextMenu(null)}>
     

      <section className="workspace">
        <article className="panel editor-panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Source</p>
              <h2>Raw editor</h2>
            </div>
            <span className={`status-chip ${parseState.valid ? 'ok' : 'error'}`}>
              <FontAwesomeIcon icon={parseState.valid ? faCheckCircle : faCircleXmark} />
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
        </article>

        <article className="panel tree-panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Inspect</p>
              <h2>Tree view</h2>
            </div>
          </div>
          <div className="tree-scroll">
            {parseState.valid ? (
              <TreeNode
                label="$"
                value={parseState.value}
                path="$"
                depth={0}
                collapsed={collapsed}
                selectedPath={selectedPath}
                onToggle={handleToggle}
                onCopyPath={handleCopyPath}
                onSelect={handleSelect}
                onContextMenu={handleContextMenu}
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
      <section className="hero-panel compact">
        <div className="hero-meta left">
          <span className="status-line">{parseState.valid ? status : parseState.error}</span>
        </div>
        <div className="hero-meta compact">
          <span className={`status-chip ${parseState.valid ? 'ok' : 'error'}`}>
            <FontAwesomeIcon icon={parseState.valid ? faCheckCircle : faCircleXmark} />
            {parseState.valid ? 'Valid' : 'Invalid'}
          </span>
          <span>{stats.topLevel}</span>
          <span>{stats.bytes} chars</span>
          <span>{activeFile ?? 'Unsaved buffer'}</span>
        </div>
      </section>
      {showGenerator ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowGenerator(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="panel-kicker">Generate</p>
                <h2>Type structures</h2>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(generated || '')
                  }}
                >
                  Copy
                </button>
                <button type="button" className="subtle" onClick={() => setShowGenerator(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="segmented">
                <button
                  type="button"
                  className={genLang === 'ts' ? 'active' : ''}
                  onClick={() => {
                    setGenLang('ts')
                    updateGenerated('ts')
                  }}
                >
                  TypeScript
                </button>
                <button
                  type="button"
                  className={genLang === 'java' ? 'active' : ''}
                  onClick={() => {
                    setGenLang('java')
                    updateGenerated('java')
                  }}
                >
                  Java
                </button>
                <button
                  type="button"
                  className={genLang === 'kt' ? 'active' : ''}
                  onClick={() => {
                    setGenLang('kt')
                    updateGenerated('kt')
                  }}
                >
                  Kotlin
                </button>
            </div>
            <pre className="generator-output modal-output">
              <code
                className={`language-${genLang}`}
                dangerouslySetInnerHTML={{
                  __html: highlighted || 'Select a node to generate types.',
                }}
              />
            </pre>
          </div>
        </div>
      ) : null}
      {showSettings ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowSettings(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="panel-kicker">Settings</p>
                <h2>Preferences</h2>
              </div>
              <div className="modal-actions">
                <button type="button" className="subtle" onClick={() => setShowSettings(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div>
                <p className="settings-title">Indent size</p>
                <p className="settings-note">Used for format and save operations.</p>
              </div>
              <div className="segmented">
                <button
                  type="button"
                  className={indentSize === 2 ? 'active' : ''}
                  onClick={() => setIndentSize(2)}
                >
                  2 spaces
                </button>
                <button
                  type="button"
                  className={indentSize === 4 ? 'active' : ''}
                  onClick={() => setIndentSize(4)}
                >
                  4 spaces
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {contextMenu ? (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              handleCopyPath(contextMenu.path)
              setContextMenu(null)
            }}
          >
            Copy path
          </button>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(
                typeof contextMenu.value === 'string'
                  ? contextMenu.value
                  : JSON.stringify(contextMenu.value, null, 2)
              )
              setStatus('Copied value')
              setContextMenu(null)
            }}
          >
            Copy value
          </button>
          <button
            type="button"
            onClick={() => {
              setShowGenerator(true)
              setContextMenu(null)
            }}
          >
            Generate code
          </button>
        </div>
      ) : null}
    </main>
  )
}

export default App

function generateFor(value: JsonValue, path: string, lang: 'ts' | 'java' | 'kt') {
  const name = nameFromPath(path)
  if (lang === 'ts') {
    return generateTypeScript(value, name)
  }
  if (lang === 'java') {
    return generateJava(value, name)
  }
  return generateKotlin(value, name)
}

function nameFromPath(path: string) {
  if (path === '$') {
    return 'Root'
  }
  const segs = pathToSegments(path)
  const last = segs[segs.length - 1] || 'Value'
  return toPascalCase(last.replace(/\d+/g, 'Item'))
}

function toPascalCase(input: string) {
  return input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')
}

function generateTypeScript(value: JsonValue, rootName: string) {
  const defs: string[] = []
  const visited = new Map<JsonValue, string>()

  const typeOf = (val: JsonValue, name: string): string => {
    if (val === null) return 'null'
    if (typeof val === 'string') return 'string'
    if (typeof val === 'number') return 'number'
    if (typeof val === 'boolean') return 'boolean'
    if (Array.isArray(val)) {
      if (val.length === 0) return 'unknown[]'
      return `${typeOf(val[0], `${name}Item`)}[]`
    }
    if (visited.has(val)) return visited.get(val) as string
    const typeName = toPascalCase(name)
    visited.set(val, typeName)
    const lines = Object.entries(val).map(
      ([key, child]) => `  ${key}: ${typeOf(child, `${typeName}${toPascalCase(key)}`)};`
    )
    defs.push(`export interface ${typeName} {\n${lines.join('\n')}\n}`)
    return typeName
  }

  typeOf(value, rootName)
  return defs.join('\n\n')
}

function generateJava(value: JsonValue, rootName: string) {
  const defs: string[] = []
  const visited = new Map<JsonValue, string>()

  const typeOf = (val: JsonValue, name: string): string => {
    if (val === null) return 'Object'
    if (typeof val === 'string') return 'String'
    if (typeof val === 'number') return 'Double'
    if (typeof val === 'boolean') return 'Boolean'
    if (Array.isArray(val)) {
      if (val.length === 0) return 'List<Object>'
      return `List<${typeOf(val[0], `${name}Item`)}>`
    }
    if (visited.has(val)) return visited.get(val) as string
    const typeName = toPascalCase(name)
    visited.set(val, typeName)
    const lines = Object.entries(val).map(
      ([key, child]) => `    ${typeOf(child, `${typeName}${toPascalCase(key)}`)} ${key}();`
    )
    defs.push(`public interface ${typeName} {\n${lines.join('\n')}\n}`)
    return typeName
  }

  typeOf(value, rootName)
  return `import java.util.List;\n\n${defs.join('\n\n')}`
}

function generateKotlin(value: JsonValue, rootName: string) {
  const defs: string[] = []
  const visited = new Map<JsonValue, string>()

  const typeOf = (val: JsonValue, name: string): string => {
    if (val === null) return 'Any?'
    if (typeof val === 'string') return 'String'
    if (typeof val === 'number') return 'Double'
    if (typeof val === 'boolean') return 'Boolean'
    if (Array.isArray(val)) {
      if (val.length === 0) return 'List<Any>'
      return `List<${typeOf(val[0], `${name}Item`)}>`
    }
    if (visited.has(val)) return visited.get(val) as string
    const typeName = toPascalCase(name)
    visited.set(val, typeName)
    const lines = Object.entries(val).map(
      ([key, child]) => `  val ${key}: ${typeOf(child, `${typeName}${toPascalCase(key)}`)}`
    )
    defs.push(`data class ${typeName}(\n${lines.join(',\n')}\n)`)
    return typeName
  }

  typeOf(value, rootName)
  return defs.join('\n\n')
}

function typeClass(value: JsonValue) {
  if (value === null) return 'value-null'
  if (Array.isArray(value)) return 'value-array'
  if (typeof value === 'string') return 'value-string'
  if (typeof value === 'number') return 'value-number'
  if (typeof value === 'boolean') return 'value-boolean'
  if (typeof value === 'object') return 'value-object'
  return 'value-unknown'
}
