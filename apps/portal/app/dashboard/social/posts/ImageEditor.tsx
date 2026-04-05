'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Canvas, Textbox, Rect, Circle, FabricImage, Shadow, filters } from 'fabric'
import type { FabricObject } from 'fabric'
import axios from 'axios'
import { TEMPLATES, TEMPLATE_COLORS, type Template, type TemplateObject } from './templates'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ImageEditorProps {
  isOpen: boolean
  onClose: () => void
  onSave: (imageDataUrl: string) => void
  backgroundImageUrl?: string
  platform: 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN'
  headline?: string
  primaryText?: string
  ctaText?: string
  businessName?: string
}

type SelectedObjectType = 'textbox' | 'rect' | 'circle' | 'image' | null

interface SelectedObjectProps {
  type: SelectedObjectType
  fontFamily?: string
  fontSize?: number
  fill?: string
  fontWeight?: string
  fontStyle?: string
  textAlign?: string
  charSpacing?: number
  opacity?: number
  stroke?: string
  strokeWidth?: number
  hasShadow?: boolean
  brightness?: number
  contrast?: number
  saturation?: number
}

/* ------------------------------------------------------------------ */
/*  Platform dimensions                                                */
/* ------------------------------------------------------------------ */

const PLATFORM_SIZES: Record<string, { width: number; height: number }> = {
  INSTAGRAM: { width: 1080, height: 1080 },
  FACEBOOK: { width: 1200, height: 628 },
  LINKEDIN: { width: 1200, height: 628 },
}

const FONT_FAMILIES = [
  'Arial',
  'Arial Black',
  'Georgia',
  'Helvetica',
  'Impact',
  'Times New Roman',
]

/* ------------------------------------------------------------------ */
/*  Inline SVG icons                                                   */
/* ------------------------------------------------------------------ */

function IconText() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  )
}

function IconHeading() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4v16" /><path d="M18 4v16" /><path d="M6 12h12" />
    </svg>
  )
}

function IconButton() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

function IconRect() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  )
}

function IconCircle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
    </svg>
  )
}

function IconImage() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  )
}

function IconUndo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 105.26-11.49L1 10" />
    </svg>
  )
}

function IconRedo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-5.26-11.49L23 10" />
    </svg>
  )
}

function IconFront() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="13" height="13" rx="2" /><rect x="9" y="9" width="13" height="13" rx="2" />
    </svg>
  )
}

function IconBack() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" /><rect x="2" y="2" width="13" height="13" rx="2" />
    </svg>
  )
}

function IconChevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function IconDuplicate() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" /><rect x="2" y="2" width="13" height="13" rx="2" />
    </svg>
  )
}

function IconAlignLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="4" x2="4" y2="20" /><rect x="8" y="6" width="12" height="4" rx="1" /><rect x="8" y="14" width="8" height="4" rx="1" />
    </svg>
  )
}

function IconAlignCenterH() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="22" /><rect x="5" y="6" width="14" height="4" rx="1" /><rect x="7" y="14" width="10" height="4" rx="1" />
    </svg>
  )
}

function IconAlignCenterV() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="12" x2="22" y2="12" /><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="7" width="4" height="10" rx="1" />
    </svg>
  )
}

function IconAlignRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="20" y1="4" x2="20" y2="20" /><rect x="4" y="6" width="12" height="4" rx="1" /><rect x="8" y="14" width="8" height="4" rx="1" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ImageEditor({
  isOpen,
  onClose,
  onSave,
  backgroundImageUrl,
  platform,
  headline,
  primaryText,
  ctaText,
  businessName,
}: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fabricRef = useRef<Canvas | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const backgroundRef = useRef<FabricImage | null>(null)

  const [selectedObj, setSelectedObj] = useState<SelectedObjectProps>({ type: null })
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [scaleFactor, setScaleFactor] = useState(1)
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false)

  const { width: canvasWidth, height: canvasHeight } = PLATFORM_SIZES[platform] ?? PLATFORM_SIZES.INSTAGRAM

  /* ---- helpers ---- */

  const pushHistory = useCallback((canvas: Canvas) => {
    const json = JSON.stringify(canvas.toJSON())
    setHistory(prev => {
      const next = prev.slice(0, historyIdx + 1)
      next.push(json)
      if (next.length > 50) next.shift()
      return next
    })
    setHistoryIdx(prev => {
      const capped = Math.min(prev + 1, 49)
      return capped
    })
  }, [historyIdx])

  const readSelectedObject = useCallback((obj: FabricObject | null | undefined) => {
    if (!obj) {
      setSelectedObj({ type: null })
      return
    }
    const t = obj.type as string
    if (t === 'textbox') {
      const tb = obj as Textbox
      setSelectedObj({
        type: 'textbox',
        fontFamily: tb.fontFamily ?? 'Arial',
        fontSize: tb.fontSize ?? 24,
        fill: (typeof tb.fill === 'string' ? tb.fill : '#FFFFFF'),
        fontWeight: String(tb.fontWeight ?? 'normal'),
        fontStyle: String(tb.fontStyle ?? 'normal'),
        textAlign: tb.textAlign ?? 'left',
        charSpacing: tb.charSpacing ?? 0,
        opacity: (tb.opacity ?? 1) * 100,
        stroke: typeof tb.stroke === 'string' ? tb.stroke : '',
        strokeWidth: tb.strokeWidth ?? 0,
        hasShadow: !!tb.shadow,
      })
    } else if (t === 'rect') {
      const r = obj as Rect
      setSelectedObj({
        type: 'rect',
        fill: typeof r.fill === 'string' ? r.fill : '#000000',
        opacity: (r.opacity ?? 1) * 100,
        stroke: typeof r.stroke === 'string' ? r.stroke : '',
        strokeWidth: r.strokeWidth ?? 0,
      })
    } else if (t === 'circle') {
      const c = obj as Circle
      setSelectedObj({
        type: 'circle',
        fill: typeof c.fill === 'string' ? c.fill : '#000000',
        opacity: (c.opacity ?? 1) * 100,
        stroke: typeof c.stroke === 'string' ? c.stroke : '',
        strokeWidth: c.strokeWidth ?? 0,
      })
    } else if (t === 'image') {
      const img = obj as FabricImage
      const imgFilters = (img.filters ?? []) as any[]
      let brightness = 0, contrast = 0, saturation = 0
      for (const f of imgFilters) {
        if (f && f.type === 'Brightness') brightness = Math.round((f.brightness ?? 0) * 100)
        if (f && f.type === 'Contrast') contrast = Math.round((f.contrast ?? 0) * 100)
        if (f && f.type === 'Saturation') saturation = Math.round((f.saturation ?? 0) * 100)
      }
      setSelectedObj({
        type: 'image',
        opacity: (img.opacity ?? 1) * 100,
        brightness,
        contrast,
        saturation,
      })
    } else {
      setSelectedObj({ type: null })
    }
  }, [])

  /* ---- compute scale ---- */

  const computeScale = useCallback(() => {
    if (!wrapperRef.current) return
    const sidebarWidth = 280
    const toolbarHeight = 56
    const bottomHeight = 120
    const padding = 32
    const vw = window.innerWidth - sidebarWidth - padding * 2
    const vh = window.innerHeight - toolbarHeight - bottomHeight - padding * 2
    const sf = Math.min(vw / canvasWidth, vh / canvasHeight, 1)
    setScaleFactor(sf)
  }, [canvasWidth, canvasHeight])

  /* ---- canvas init ---- */

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return

    computeScale()
    window.addEventListener('resize', computeScale)

    const c = new Canvas(canvasRef.current, {
      width: canvasWidth,
      height: canvasHeight,
      backgroundColor: '#1a1a1a',
    })
    fabricRef.current = c

    // Load background image
    if (backgroundImageUrl) {
      FabricImage.fromURL(backgroundImageUrl, { crossOrigin: 'anonymous' })
        .then((img: FabricImage) => {
          // Scale to cover the entire canvas (no gaps)
          const imgW = img.width ?? 1
          const imgH = img.height ?? 1
          const scale = Math.max(canvasWidth / imgW, canvasHeight / imgH)
          img.set({
            scaleX: scale,
            scaleY: scale,
            left: (canvasWidth - imgW * scale) / 2,
            top: (canvasHeight - imgH * scale) / 2,
            selectable: false,
            evented: false,
          })
          c.insertAt(0, img)
          backgroundRef.current = img
          c.renderAll()
        })
        .catch(() => { /* background load failed, continue with solid color */ })
    }

    // Pre-populate headline
    if (headline) {
      const tb = new Textbox(headline, {
        left: canvasWidth * 0.08,
        top: canvasHeight * 0.3,
        width: canvasWidth * 0.84,
        fontSize: 56,
        fontFamily: 'Arial Black',
        fontWeight: 'bold',
        fill: '#FFFFFF',
        textAlign: 'left',
      })
      c.add(tb)
    }

    // Pre-populate primary text
    if (primaryText) {
      const tb = new Textbox(primaryText, {
        left: canvasWidth * 0.08,
        top: canvasHeight * 0.55,
        width: canvasWidth * 0.7,
        fontSize: 22,
        fontFamily: 'Arial',
        fill: '#D0D0D0',
        textAlign: 'left',
      })
      c.add(tb)
    }

    // Pre-populate CTA button
    if (ctaText) {
      const btnRect = new Rect({
        left: canvasWidth * 0.08,
        top: canvasHeight * 0.78,
        width: canvasWidth * 0.3,
        height: canvasHeight * 0.06,
        fill: '#FF4D00',
        rx: 25,
        ry: 25,
      })
      const btnText = new Textbox(ctaText, {
        left: canvasWidth * 0.1,
        top: canvasHeight * 0.79,
        width: canvasWidth * 0.26,
        fontSize: 20,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        fill: '#FFFFFF',
        textAlign: 'center',
      })
      c.add(btnRect)
      c.add(btnText)
    }

    // Pre-populate business name
    if (businessName) {
      const tb = new Textbox(businessName.toUpperCase(), {
        left: canvasWidth * 0.08,
        top: canvasHeight * 0.92,
        width: canvasWidth * 0.4,
        fontSize: 14,
        fontFamily: 'Arial',
        fill: 'rgba(255,255,255,0.5)',
        charSpacing: 200,
      })
      c.add(tb)
    }

    c.renderAll()

    // Events
    const onSelect = () => readSelectedObject(c.getActiveObject())
    c.on('selection:created', onSelect)
    c.on('selection:updated', onSelect)
    c.on('selection:cleared', () => setSelectedObj({ type: null }))
    c.on('object:modified', () => {
      pushHistory(c)
      readSelectedObject(c.getActiveObject())
    })

    // Initial history snapshot
    const initialJson = JSON.stringify(c.toJSON())
    setHistory([initialJson])
    setHistoryIdx(0)

    return () => {
      window.removeEventListener('resize', computeScale)
      c.off('selection:created', onSelect)
      c.off('selection:updated', onSelect)
      c.off('selection:cleared')
      c.off('object:modified')
      c.dispose()
      fabricRef.current = null
      backgroundRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  /* ---- keyboard shortcuts ---- */

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      const c = fabricRef.current
      if (!c) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Only delete if we are not editing text
        const active = c.getActiveObject()
        if (active && !(active.type === 'textbox' && (active as Textbox).isEditing)) {
          c.remove(active)
          c.discardActiveObject()
          c.renderAll()
          pushHistory(c)
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, historyIdx, history])

  /* ---- undo / redo ---- */

  function handleUndo() {
    const c = fabricRef.current
    if (!c || historyIdx <= 0) return
    const newIdx = historyIdx - 1
    c.loadFromJSON(JSON.parse(history[newIdx])).then(() => {
      c.renderAll()
      setHistoryIdx(newIdx)
    })
  }

  function handleRedo() {
    const c = fabricRef.current
    if (!c || historyIdx >= history.length - 1) return
    const newIdx = historyIdx + 1
    c.loadFromJSON(JSON.parse(history[newIdx])).then(() => {
      c.renderAll()
      setHistoryIdx(newIdx)
    })
  }

  /* ---- toolbar actions ---- */

  function addText() {
    const c = fabricRef.current
    if (!c) return
    const tb = new Textbox('Your text here', {
      left: canvasWidth * 0.1,
      top: canvasHeight * 0.5,
      width: canvasWidth * 0.5,
      fontSize: 24,
      fill: '#FFFFFF',
      fontFamily: 'Arial',
    })
    c.add(tb)
    c.setActiveObject(tb)
    c.renderAll()
    pushHistory(c)
  }

  function addHeading() {
    const c = fabricRef.current
    if (!c) return
    const tb = new Textbox('HEADING', {
      left: canvasWidth * 0.1,
      top: canvasHeight * 0.35,
      width: canvasWidth * 0.8,
      fontSize: 56,
      fontFamily: 'Arial Black',
      fontWeight: 'bold',
      fill: '#FFFFFF',
    })
    c.add(tb)
    c.setActiveObject(tb)
    c.renderAll()
    pushHistory(c)
  }

  function addCtaButton() {
    const c = fabricRef.current
    if (!c) return
    const btnBg = new Rect({
      left: canvasWidth * 0.3,
      top: canvasHeight * 0.75,
      width: canvasWidth * 0.3,
      height: canvasHeight * 0.06,
      fill: '#FF4D00',
      rx: 25,
      ry: 25,
    })
    const btnLabel = new Textbox('GET STARTED', {
      left: canvasWidth * 0.32,
      top: canvasHeight * 0.76,
      width: canvasWidth * 0.26,
      fontSize: 20,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      fill: '#FFFFFF',
      textAlign: 'center',
    })
    c.add(btnBg)
    c.add(btnLabel)
    c.setActiveObject(btnLabel)
    c.renderAll()
    pushHistory(c)
  }

  function addRectangle() {
    const c = fabricRef.current
    if (!c) return
    const r = new Rect({
      left: canvasWidth * 0.2,
      top: canvasHeight * 0.2,
      width: canvasWidth * 0.3,
      height: canvasHeight * 0.15,
      fill: 'rgba(0,0,0,0.5)',
      rx: 10,
      ry: 10,
    })
    c.add(r)
    c.setActiveObject(r)
    c.renderAll()
    pushHistory(c)
    setShapeMenuOpen(false)
  }

  function addCircle() {
    const c = fabricRef.current
    if (!c) return
    const ci = new Circle({
      left: canvasWidth * 0.4,
      top: canvasHeight * 0.4,
      radius: 50,
      fill: 'rgba(255,77,0,0.8)',
    })
    c.add(ci)
    c.setActiveObject(ci)
    c.renderAll()
    pushHistory(c)
    setShapeMenuOpen(false)
  }

  function handleUploadImage() {
    fileInputRef.current?.click()
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !fabricRef.current) return
    const reader = new FileReader()
    reader.onload = () => {
      const url = reader.result as string
      FabricImage.fromURL(url).then((img) => {
        const c = fabricRef.current!
        // Scale image to fit within 50% of canvas
        const maxW = canvasWidth * 0.5
        const maxH = canvasHeight * 0.5
        const imgW = img.width ?? maxW
        const imgH = img.height ?? maxH
        const sf = Math.min(maxW / imgW, maxH / imgH, 1)
        img.scale(sf)
        img.set({
          left: canvasWidth * 0.25,
          top: canvasHeight * 0.25,
        })
        c.add(img)
        c.setActiveObject(img)
        c.renderAll()
        pushHistory(c)
      })
    }
    reader.readAsDataURL(file)
    // Reset so the same file can be selected again
    e.target.value = ''
  }

  function deleteSelected() {
    const c = fabricRef.current
    if (!c) return
    const active = c.getActiveObject()
    if (active) {
      c.remove(active)
      c.discardActiveObject()
      c.renderAll()
      pushHistory(c)
    }
  }

  /* ---- duplicate object ---- */

  function duplicateSelected() {
    const c = fabricRef.current
    if (!c) return
    const obj = c.getActiveObject()
    if (!obj) return
    obj.clone().then((cloned: FabricObject) => {
      cloned.set({ left: (obj.left ?? 0) + 20, top: (obj.top ?? 0) + 20 })
      c.add(cloned)
      c.setActiveObject(cloned)
      c.renderAll()
      pushHistory(c)
    })
  }

  /* ---- alignment helpers ---- */

  function alignCenterH() {
    const c = fabricRef.current
    if (!c) return
    const obj = c.getActiveObject()
    if (!obj) return
    obj.set({ left: canvasWidth / 2 - (obj.width ?? 0) * (obj.scaleX ?? 1) / 2 })
    c.renderAll()
    pushHistory(c)
  }

  function alignCenterV() {
    const c = fabricRef.current
    if (!c) return
    const obj = c.getActiveObject()
    if (!obj) return
    obj.set({ top: canvasHeight / 2 - (obj.height ?? 0) * (obj.scaleY ?? 1) / 2 })
    c.renderAll()
    pushHistory(c)
  }

  function alignLeft() {
    const c = fabricRef.current
    if (!c) return
    const obj = c.getActiveObject()
    if (!obj) return
    obj.set({ left: 20 })
    c.renderAll()
    pushHistory(c)
  }

  function alignRight() {
    const c = fabricRef.current
    if (!c) return
    const obj = c.getActiveObject()
    if (!obj) return
    obj.set({ left: canvasWidth - (obj.width ?? 0) * (obj.scaleX ?? 1) - 20 })
    c.renderAll()
    pushHistory(c)
  }

  /* ---- image filter helpers ---- */

  function updateImageFilter(filterType: 'Brightness' | 'Contrast' | 'Saturation', value: number) {
    const c = fabricRef.current
    if (!c) return
    const obj = c.getActiveObject()
    if (!obj || obj.type !== 'image') return
    const img = obj as FabricImage
    const currentFilters = (img.filters ?? []) as any[]

    // Remove existing filter of this type
    const newFilters = currentFilters.filter((f: any) => f && f.type !== filterType)

    // Add new filter
    const normalised = value / 100
    if (filterType === 'Brightness') {
      newFilters.push(new filters.Brightness({ brightness: normalised }))
    } else if (filterType === 'Contrast') {
      newFilters.push(new filters.Contrast({ contrast: normalised }))
    } else if (filterType === 'Saturation') {
      newFilters.push(new filters.Saturation({ saturation: normalised }))
    }

    img.filters = newFilters
    img.applyFilters()
    c.renderAll()
    readSelectedObject(obj)
  }

  /* ---- text shadow toggle ---- */

  function toggleTextShadow() {
    const c = fabricRef.current
    if (!c) return
    const obj = c.getActiveObject()
    if (!obj || obj.type !== 'textbox') return
    if (obj.shadow) {
      obj.set('shadow', null)
    } else {
      obj.set('shadow', new Shadow({ color: 'rgba(0,0,0,0.5)', blur: 4, offsetX: 2, offsetY: 2 }))
    }
    c.renderAll()
    readSelectedObject(obj)
    pushHistory(c)
  }

  /* ---- template application ---- */

  const [customising, setCustomising] = useState(false)

  async function applyTemplate(template: Template) {
    const c = fabricRef.current
    if (!c) return

    // Remove all objects except the background image
    const objects = c.getObjects().slice()
    for (const obj of objects) {
      if (obj === backgroundRef.current) continue
      c.remove(obj)
    }

    // Collect all text placeholders from the template
    const textObjects = template.objects.filter(o => o.type === 'textbox' && o.text)
    const placeholderTexts = textObjects.map(o => o.text || '')

    // Call API to customise text for this client's industry
    let customisedTexts: string[] = placeholderTexts
    try {
      setCustomising(true)
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      const res = await axios.post(
        `${API_URL}/social/templates/customise`,
        { templateTexts: placeholderTexts, templateName: template.name },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      )
      if (res.data.texts?.length === placeholderTexts.length) {
        customisedTexts = res.data.texts
      }
    } catch {
      // Fall back to original placeholder text if API fails
    } finally {
      setCustomising(false)
    }

    // Map customised texts back to template objects
    let textIndex = 0
    const customisedObjects = template.objects.map(tObj => {
      if (tObj.type === 'textbox' && tObj.text) {
        const customised = { ...tObj, text: customisedTexts[textIndex] || tObj.text }
        textIndex++
        return customised
      }
      return tObj
    })

    // Add template objects with customised text
    for (const tObj of customisedObjects) {
      const absLeft = (tObj.left / 100) * canvasWidth
      const absTop = (tObj.top / 100) * canvasHeight
      const absWidth = tObj.width != null ? (tObj.width / 100) * canvasWidth : undefined
      const absHeight = tObj.height != null ? (tObj.height / 100) * canvasHeight : undefined

      if (tObj.type === 'rect') {
        // For full-canvas overlays (width=100%, height>=50%), ensure background stays visible
        const isFullOverlay = (tObj.width ?? 0) >= 90 && (tObj.height ?? 0) >= 40
        let fill = tObj.fill ?? '#000000'
        let opacity = tObj.opacity ?? 1

        if (isFullOverlay && backgroundRef.current) {
          // If background image exists, cap overlay opacity so image shows through
          // Parse rgba or apply max opacity
          if (fill.startsWith('rgba(')) {
            // Already has alpha — keep it but ensure it's not too opaque
            const match = fill.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
            if (match) {
              const alpha = Math.min(parseFloat(match[4]), 0.6) // cap at 0.6
              fill = `rgba(${match[1]},${match[2]},${match[3]},${alpha})`
            }
          } else {
            // Solid color — make it semi-transparent
            opacity = 0.5
          }
        }

        const r = new Rect({
          left: absLeft,
          top: absTop,
          width: absWidth ?? 100,
          height: absHeight ?? 100,
          fill,
          rx: tObj.rx ?? 0,
          ry: tObj.ry ?? 0,
          opacity,
          stroke: tObj.stroke ?? '',
          strokeWidth: tObj.strokeWidth ?? 0,
        })
        c.add(r)
      } else if (tObj.type === 'circle') {
        const radiusPx = tObj.radius != null ? (tObj.radius / 100) * Math.min(canvasWidth, canvasHeight) : 50
        const ci = new Circle({
          left: absLeft,
          top: absTop,
          radius: radiusPx,
          fill: tObj.fill ?? '#FF4D00',
          opacity: tObj.opacity ?? 1,
          stroke: tObj.stroke ?? '',
          strokeWidth: tObj.strokeWidth ?? 0,
        })
        c.add(ci)
      } else if (tObj.type === 'textbox') {
        // Replace placeholder text with provided props if appropriate
        let text = tObj.text ?? 'Text'
        if (headline && (text.includes('HEADLINE') || text.includes('HEADING') || tObj.fontSize && tObj.fontSize >= 40)) {
          text = headline
        } else if (primaryText && tObj.fontSize && tObj.fontSize >= 18 && tObj.fontSize <= 28 && !text.includes('@') && !text.includes('GET') && !text.includes('LEARN') && !text.includes('STARTED') && !text.includes('CLAIM') && !text.includes('BOOK') && !text.includes('START') && tObj.fontWeight !== 'bold') {
          text = primaryText
        } else if (ctaText && tObj.fontWeight === 'bold' && tObj.fontSize && tObj.fontSize <= 22 && (tObj.textAlign === 'center') && text === text.toUpperCase()) {
          text = ctaText.toUpperCase()
        } else if (businessName && (text.includes('BRAND') || text.includes('brand') || text.includes('@your'))) {
          text = businessName.toUpperCase()
        }

        const tb = new Textbox(text, {
          left: absLeft,
          top: absTop,
          width: absWidth ?? canvasWidth * 0.5,
          fontSize: tObj.fontSize ?? 24,
          fontFamily: tObj.fontFamily ?? 'Arial',
          fontWeight: (tObj.fontWeight as '' | 'normal' | 'bold') ?? 'normal',
          fill: tObj.fill ?? '#FFFFFF',
          textAlign: tObj.textAlign ?? 'left',
          charSpacing: tObj.charSpacing ?? tObj.letterSpacing ?? 0,
          lineHeight: tObj.lineHeight ?? 1.2,
          opacity: tObj.opacity ?? 1,
        })
        c.add(tb)
      }
    }

    c.discardActiveObject()
    c.renderAll()
    pushHistory(c)
  }

  /* ---- property updates ---- */

  function updateActiveObject(props: Record<string, unknown>) {
    const c = fabricRef.current
    if (!c) return
    const obj = c.getActiveObject()
    if (!obj) return
    obj.set(props)
    c.renderAll()
    readSelectedObject(obj)
  }

  function bringToFront() {
    const c = fabricRef.current
    if (!c) return
    const obj = c.getActiveObject()
    if (obj) {
      c.bringObjectToFront(obj)
      c.renderAll()
      pushHistory(c)
    }
  }

  function sendToBack() {
    const c = fabricRef.current
    if (!c) return
    const obj = c.getActiveObject()
    if (!obj) return
    // Send to back but keep background image at index 0
    c.sendObjectToBack(obj)
    if (backgroundRef.current) {
      c.sendObjectToBack(backgroundRef.current)
    }
    c.renderAll()
    pushHistory(c)
  }

  /* ---- save ---- */

  function handleSave() {
    if (!fabricRef.current) return
    const dataUrl = fabricRef.current.toDataURL({ format: 'jpeg', quality: 0.92 } as any)
    onSave(dataUrl)
  }

  /* ---- render ---- */

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950" ref={wrapperRef}>
      {/* ===== TOP TOOLBAR ===== */}
      <div className="flex items-center gap-1 px-4 h-14 bg-gray-900 border-b border-gray-800 shrink-0">
        {/* Add Text */}
        <ToolbarBtn label="Add Text" onClick={addText}><IconText /></ToolbarBtn>
        <ToolbarBtn label="Add Heading" onClick={addHeading}><IconHeading /></ToolbarBtn>
        <ToolbarBtn label="Add CTA Button" onClick={addCtaButton}><IconButton /></ToolbarBtn>

        {/* Shape dropdown */}
        <div className="relative">
          <ToolbarBtn label="Add Shape" onClick={() => setShapeMenuOpen(!shapeMenuOpen)}>
            <IconRect />
            <IconChevron />
          </ToolbarBtn>
          {shapeMenuOpen && (
            <div className="absolute top-full left-0 mt-1 w-44 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1">
              <button
                onClick={addRectangle}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
              >
                <IconRect /> Rectangle
              </button>
              <button
                onClick={addCircle}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
              >
                <IconCircle /> Circle
              </button>
            </div>
          )}
        </div>

        <ToolbarBtn label="Upload Image" onClick={handleUploadImage}><IconImage /></ToolbarBtn>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileSelected} />

        <div className="w-px h-6 bg-gray-700 mx-2" />

        <ToolbarBtn label="Undo (Ctrl+Z)" onClick={handleUndo} disabled={historyIdx <= 0}><IconUndo /></ToolbarBtn>
        <ToolbarBtn label="Redo (Ctrl+Y)" onClick={handleRedo} disabled={historyIdx >= history.length - 1}><IconRedo /></ToolbarBtn>

        <div className="w-px h-6 bg-gray-700 mx-2" />

        <ToolbarBtn label="Delete Selected" onClick={deleteSelected}><IconTrash /></ToolbarBtn>
        <ToolbarBtn label="Duplicate Selected" onClick={duplicateSelected}><IconDuplicate /></ToolbarBtn>

        <div className="w-px h-6 bg-gray-700 mx-2" />

        {/* Alignment tools */}
        <ToolbarBtn label="Align Left" onClick={alignLeft}><IconAlignLeft /></ToolbarBtn>
        <ToolbarBtn label="Align Center Horizontal" onClick={alignCenterH}><IconAlignCenterH /></ToolbarBtn>
        <ToolbarBtn label="Align Center Vertical" onClick={alignCenterV}><IconAlignCenterV /></ToolbarBtn>
        <ToolbarBtn label="Align Right" onClick={alignRight}><IconAlignRight /></ToolbarBtn>

        {/* Platform badge */}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-500 font-mono">{canvasWidth} x {canvasHeight}</span>
          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-medium">{platform}</span>
        </div>
      </div>

      {/* ===== MAIN AREA ===== */}
      <div className="flex flex-1 min-h-0">
        {/* Canvas area */}
        <div className="flex-1 flex items-center justify-center overflow-hidden bg-gray-950 p-4">
          <div
            style={{
              width: canvasWidth * scaleFactor,
              height: canvasHeight * scaleFactor,
              position: 'relative',
            }}
          >
            <div
              style={{
                transform: `scale(${scaleFactor})`,
                transformOrigin: 'top left',
                width: canvasWidth,
                height: canvasHeight,
              }}
            >
              <canvas ref={canvasRef} />
            </div>
          </div>
        </div>

        {/* ===== RIGHT SIDEBAR ===== */}
        <div className="w-[280px] bg-gray-900 border-l border-gray-800 flex flex-col shrink-0 overflow-y-auto">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-300">Properties</h3>
          </div>

          <div className="p-4 flex-1 space-y-4">
            {selectedObj.type === null && (
              <p className="text-sm text-gray-500 text-center mt-8">Select an element to edit its properties</p>
            )}

            {/* ---- Textbox properties ---- */}
            {selectedObj.type === 'textbox' && (
              <>
                {/* Font family */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Font Family</label>
                  <select
                    value={selectedObj.fontFamily ?? 'Arial'}
                    onChange={(e) => updateActiveObject({ fontFamily: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {FONT_FAMILIES.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>

                {/* Font size */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Font Size: {selectedObj.fontSize}px</label>
                  <input
                    type="range"
                    min={12}
                    max={120}
                    value={selectedObj.fontSize ?? 24}
                    onChange={(e) => updateActiveObject({ fontSize: Number(e.target.value) })}
                    className="w-full accent-indigo-500"
                  />
                </div>

                {/* Color */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Color</label>
                  <input
                    type="color"
                    value={selectedObj.fill ?? '#FFFFFF'}
                    onChange={(e) => updateActiveObject({ fill: e.target.value })}
                    className="w-10 h-8 bg-transparent border border-gray-700 rounded cursor-pointer"
                  />
                </div>

                {/* Bold / Italic */}
                <div className="flex gap-2">
                  <button
                    onClick={() => updateActiveObject({ fontWeight: selectedObj.fontWeight === 'bold' ? 'normal' : 'bold' })}
                    className={`px-3 py-1.5 text-sm font-bold rounded border ${selectedObj.fontWeight === 'bold' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
                  >
                    B
                  </button>
                  <button
                    onClick={() => updateActiveObject({ fontStyle: selectedObj.fontStyle === 'italic' ? 'normal' : 'italic' })}
                    className={`px-3 py-1.5 text-sm italic rounded border ${selectedObj.fontStyle === 'italic' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
                  >
                    I
                  </button>
                </div>

                {/* Text align */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Text Align</label>
                  <div className="flex gap-1">
                    {(['left', 'center', 'right'] as const).map((align) => (
                      <button
                        key={align}
                        onClick={() => updateActiveObject({ textAlign: align })}
                        className={`flex-1 px-2 py-1.5 text-xs rounded border ${selectedObj.textAlign === align ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
                      >
                        {align.charAt(0).toUpperCase() + align.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Letter spacing */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Letter Spacing: {selectedObj.charSpacing}</label>
                  <input
                    type="range"
                    min={-100}
                    max={800}
                    value={selectedObj.charSpacing ?? 0}
                    onChange={(e) => updateActiveObject({ charSpacing: Number(e.target.value) })}
                    className="w-full accent-indigo-500"
                  />
                </div>

                {/* Opacity */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Opacity: {Math.round(selectedObj.opacity ?? 100)}%</label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={selectedObj.opacity ?? 100}
                    onChange={(e) => updateActiveObject({ opacity: Number(e.target.value) / 100 })}
                    className="w-full accent-indigo-500"
                  />
                </div>

                {/* Text Shadow */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Text Shadow</label>
                  <button
                    onClick={toggleTextShadow}
                    className={`px-3 py-1.5 text-xs rounded border ${selectedObj.hasShadow ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
                  >
                    {selectedObj.hasShadow ? 'Shadow ON' : 'Shadow OFF'}
                  </button>
                </div>

                {/* Text Outline */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Text Outline</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={selectedObj.stroke || '#000000'}
                      onChange={(e) => updateActiveObject({ stroke: e.target.value })}
                      className="w-8 h-7 bg-transparent border border-gray-700 rounded cursor-pointer"
                    />
                    <input
                      type="range"
                      min={0}
                      max={5}
                      step={0.5}
                      value={selectedObj.strokeWidth ?? 0}
                      onChange={(e) => updateActiveObject({ strokeWidth: Number(e.target.value) })}
                      className="flex-1 accent-indigo-500"
                    />
                    <span className="text-xs text-gray-500 w-8">{selectedObj.strokeWidth ?? 0}px</span>
                  </div>
                </div>
              </>
            )}

            {/* ---- Rect / Circle properties ---- */}
            {(selectedObj.type === 'rect' || selectedObj.type === 'circle') && (
              <>
                {/* Fill color */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Fill Color</label>
                  <input
                    type="color"
                    value={selectedObj.fill ?? '#000000'}
                    onChange={(e) => updateActiveObject({ fill: e.target.value })}
                    className="w-10 h-8 bg-transparent border border-gray-700 rounded cursor-pointer"
                  />
                </div>

                {/* Opacity */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Opacity: {Math.round(selectedObj.opacity ?? 100)}%</label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={selectedObj.opacity ?? 100}
                    onChange={(e) => updateActiveObject({ opacity: Number(e.target.value) / 100 })}
                    className="w-full accent-indigo-500"
                  />
                </div>

                {/* Border color */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Border Color</label>
                  <input
                    type="color"
                    value={selectedObj.stroke ?? '#000000'}
                    onChange={(e) => updateActiveObject({ stroke: e.target.value })}
                    className="w-10 h-8 bg-transparent border border-gray-700 rounded cursor-pointer"
                  />
                </div>

                {/* Border width */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Border Width: {selectedObj.strokeWidth ?? 0}px</label>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    value={selectedObj.strokeWidth ?? 0}
                    onChange={(e) => updateActiveObject({ strokeWidth: Number(e.target.value) })}
                    className="w-full accent-indigo-500"
                  />
                </div>
              </>
            )}

            {/* ---- Image properties ---- */}
            {selectedObj.type === 'image' && (
              <>
                {/* Opacity */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Opacity: {Math.round(selectedObj.opacity ?? 100)}%</label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={selectedObj.opacity ?? 100}
                    onChange={(e) => updateActiveObject({ opacity: Number(e.target.value) / 100 })}
                    className="w-full accent-indigo-500"
                  />
                </div>

                {/* Brightness */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Brightness: {selectedObj.brightness ?? 0}</label>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={selectedObj.brightness ?? 0}
                    onChange={(e) => updateImageFilter('Brightness', Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>

                {/* Contrast */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Contrast: {selectedObj.contrast ?? 0}</label>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={selectedObj.contrast ?? 0}
                    onChange={(e) => updateImageFilter('Contrast', Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>

                {/* Saturation */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Saturation: {selectedObj.saturation ?? 0}</label>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={selectedObj.saturation ?? 0}
                    onChange={(e) => updateImageFilter('Saturation', Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>
              </>
            )}

            {/* ---- Layer controls (all types) ---- */}
            {selectedObj.type !== null && (
              <div className="pt-2 border-t border-gray-800">
                <label className="block text-xs text-gray-400 mb-2">Layer Order</label>
                <div className="flex gap-2">
                  <button
                    onClick={bringToFront}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"
                  >
                    <IconFront /> Bring to Front
                  </button>
                  <button
                    onClick={sendToBack}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"
                  >
                    <IconBack /> Send to Back
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== BOTTOM BAR ===== */}
      <div className="shrink-0 bg-gray-900 border-t border-gray-800 px-4 py-3">
        <div className="flex items-center gap-4">
          {/* Template selector */}
          {customising && (
            <div className="flex items-center gap-2 text-xs text-indigo-400 shrink-0">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              Customising for your business...
            </div>
          )}
          <div className="flex-1 overflow-x-auto">
            <div className="flex gap-3">
              {TEMPLATES.map((tpl) => {
                const colors = TEMPLATE_COLORS[tpl.id] ?? { bg: '#333', accent: '#fff' }
                return (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl)}
                    disabled={customising}
                    className="shrink-0 flex flex-col items-center gap-1 group disabled:opacity-50"
                    title={tpl.description}
                  >
                    <div
                      className="w-[80px] h-[80px] rounded-lg border-2 border-gray-700 group-hover:border-indigo-500 transition-colors flex items-center justify-center overflow-hidden"
                      style={{ backgroundColor: colors.bg }}
                    >
                      <div className="text-center px-1">
                        <div className="w-10 h-1 mx-auto mb-1 rounded" style={{ backgroundColor: colors.accent }} />
                        <div className="w-12 h-0.5 mx-auto mb-0.5 bg-white/30 rounded" />
                        <div className="w-8 h-0.5 mx-auto bg-white/20 rounded" />
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400 group-hover:text-gray-200 transition-colors max-w-[80px] truncate">
                      {tpl.name}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 shrink-0 pl-4 border-l border-gray-800">
            <button
              onClick={onClose}
              className="px-5 py-2 text-sm rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition-colors"
            >
              Save &amp; Use
            </button>
          </div>
        </div>
      </div>

      {/* Close shape menu on outside click */}
      {shapeMenuOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setShapeMenuOpen(false)} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Toolbar Button                                                     */
/* ------------------------------------------------------------------ */

function ToolbarBtn({
  children,
  onClick,
  label,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`relative flex items-center gap-1 px-2.5 py-2 text-sm rounded-lg transition-colors ${
        disabled
          ? 'text-gray-600 cursor-not-allowed'
          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}
