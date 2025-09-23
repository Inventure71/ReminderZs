;(function () {
  class UIDrawingCanvas {
    constructor(width = 400, height = 300) {
      this.width = width
      this.height = height
      this.isDrawing = false
      this.currentPath = []
      this.paths = []
      this.lastPoint = null
      this.tool = 'pen' // pen, eraser, select
      this.strokeColor = '#7aa2f7'
      this.strokeWidth = 2
      this.components = [] // Recognized UI components
      
      this.canvas = this.#createCanvas()
      this.ctx = this.canvas.getContext('2d')
      this.#setupCanvas()
      this.#bindEvents()
    }

    #createCanvas() {
      const canvas = document.createElement('canvas')
      canvas.width = this.width
      canvas.height = this.height
      canvas.className = 'ui-drawing-canvas'
      canvas.style.cssText = `
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #0a0c10;
        cursor: crosshair;
        display: block;
        margin: 8px 0;
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
      `
      return canvas
    }

    #setupCanvas() {
      console.log('[UIDrawingCanvas] Setting up canvas with dimensions:', this.width, 'x', this.height)
      
      // Set the canvas actual dimensions first
      this.canvas.width = this.width
      this.canvas.height = this.height
      
      // Set the display size
      this.canvas.style.width = this.width + 'px'
      this.canvas.style.height = this.height + 'px'
      
      // Set up the context
      this.ctx.lineCap = 'round'
      this.ctx.lineJoin = 'round'
      this.ctx.strokeStyle = this.strokeColor
      this.ctx.lineWidth = this.strokeWidth
      
      console.log('[UIDrawingCanvas] Canvas setup complete - actual size:', this.canvas.width, 'x', this.canvas.height, 'display size:', this.canvas.style.width, 'x', this.canvas.style.height)
      
      // Note: Temporarily disabling high DPI scaling to fix mouse alignment
      // This can be re-enabled later if needed
      console.log('[UIDrawingCanvas] Skipping high DPI scaling to ensure proper mouse alignment')
    }

    #bindEvents() {
      console.log('[UIDrawingCanvas] Binding events to canvas:', this.canvas)
      
      // Prevent event bubbling to block dragging
      this.canvas.addEventListener('pointerdown', (e) => {
        console.log('[UIDrawingCanvas] Pointer down:', e.offsetX, e.offsetY)
        e.stopPropagation()
        this.#startDrawing(e)
      })
      
      this.canvas.addEventListener('pointermove', (e) => {
        if (this.isDrawing) {
          console.log('[UIDrawingCanvas] Pointer move (drawing):', e.offsetX, e.offsetY)
        }
        e.stopPropagation()
        this.#draw(e)
      })
      
      this.canvas.addEventListener('pointerup', (e) => {
        console.log('[UIDrawingCanvas] Pointer up:', e.offsetX, e.offsetY)
        e.stopPropagation()
        this.#stopDrawing(e)
      })
      
      this.canvas.addEventListener('pointerleave', (e) => {
        console.log('[UIDrawingCanvas] Pointer leave')
        this.#stopDrawing(e)
      })
      
      // Prevent context menu
      this.canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault()
      })
      
      // Add click event for testing
      this.canvas.addEventListener('click', (e) => {
        console.log('[UIDrawingCanvas] Canvas clicked at:', e.offsetX, e.offsetY)
      })
      
      console.log('[UIDrawingCanvas] Event binding complete')
    }

    #getCanvasPoint(e) {
      const rect = this.canvas.getBoundingClientRect()
      
      // Account for any scaling applied to the canvas
      const scaleX = this.canvas.width / rect.width
      const scaleY = this.canvas.height / rect.height
      
      const x = (e.clientX - rect.left) * scaleX
      const y = (e.clientY - rect.top) * scaleY
      
      console.log('[UIDrawingCanvas] Mouse pos:', e.clientX - rect.left, e.clientY - rect.top, 'Canvas pos:', x, y, 'Scale:', scaleX, scaleY)
      
      return { x, y }
    }

    #startDrawing(e) {
      console.log('[UIDrawingCanvas] Starting drawing...')
      this.isDrawing = true
      const point = this.#getCanvasPoint(e)
      console.log('[UIDrawingCanvas] Start point:', point)
      this.lastPoint = point
      this.currentPath = [point]
      
      this.ctx.beginPath()
      this.ctx.moveTo(point.x, point.y)
      console.log('[UIDrawingCanvas] Drawing started successfully')
    }

    #draw(e) {
      if (!this.isDrawing) return
      
      const point = this.#getCanvasPoint(e)
      this.currentPath.push(point)
      
      // Set up the drawing style
      if (this.tool === 'pen') {
        this.ctx.strokeStyle = this.strokeColor
        this.ctx.globalCompositeOperation = 'source-over'
      } else if (this.tool === 'eraser') {
        this.ctx.globalCompositeOperation = 'destination-out'
      }
      
      this.ctx.lineWidth = this.strokeWidth
      this.ctx.lineCap = 'round'
      this.ctx.lineJoin = 'round'
      
      // Draw a line from the last point to the current point
      this.ctx.beginPath()
      this.ctx.moveTo(this.lastPoint.x, this.lastPoint.y)
      this.ctx.lineTo(point.x, point.y)
      this.ctx.stroke()
      
      console.log('[UIDrawingCanvas] Drew line from', this.lastPoint, 'to', point)
      this.lastPoint = point
    }

    #stopDrawing(e) {
      if (!this.isDrawing) return
      
      this.isDrawing = false
      
      if (this.currentPath.length > 1) {
        // Save the completed path
        this.paths.push({
          points: [...this.currentPath],
          tool: this.tool,
          color: this.strokeColor,
          width: this.strokeWidth,
          timestamp: Date.now()
        })
        
        // Trigger component recognition after drawing
        this.#recognizeComponents()
        
        // Dispatch drawing complete event
        const event = new CustomEvent('ui-drawing:path-complete', {
          detail: { 
            path: this.paths[this.paths.length - 1],
            totalPaths: this.paths.length,
            components: this.components
          }
        })
        this.canvas.dispatchEvent(event)
      }
      
      this.currentPath = []
    }

    #recognizeComponents() {
      // Placeholder for component recognition
      // This would analyze the drawn paths and identify UI components
      
      const newComponents = []
      
      // Simple shape recognition (placeholder)
      for (const path of this.paths) {
        const component = this.#analyzePath(path)
        if (component) {
          newComponents.push(component)
        }
      }
      
      this.components = newComponents
    }

    #analyzePath(path) {
      if (path.points.length < 3) return null
      
      const bounds = this.#getPathBounds(path.points)
      const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
      
      // Minimum size threshold
      if (area < 100) return null
      
      // Simple shape detection based on path characteristics
      const aspectRatio = (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY)
      const isRectangular = this.#isRectangularPath(path.points, bounds)
      const isCircular = this.#isCircularPath(path.points, bounds)
      
      let componentType = 'unknown'
      let properties = {}
      
      if (isRectangular) {
        if (aspectRatio > 3) {
          componentType = 'text_input'
          properties = { placeholder: 'Enter text...' }
        } else if (aspectRatio < 0.3) {
          componentType = 'text_input'
          properties = { placeholder: 'Enter text...', orientation: 'vertical' }
        } else if (Math.abs(aspectRatio - 1) < 0.3) {
          componentType = 'button'
          properties = { text: 'Button' }
        } else {
          componentType = 'panel'
          properties = {}
        }
      } else if (isCircular) {
        if (area < 400) {
          componentType = 'radio_button'
          properties = { checked: false }
        } else {
          componentType = 'button'
          properties = { text: 'Button', shape: 'round' }
        }
      } else {
        // Free-form drawing - could be text, icon, or custom shape
        componentType = 'custom_shape'
        properties = { paths: [path] }
      }
      
      return {
        id: `ui_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: componentType,
        bounds: bounds,
        properties: properties,
        path: path,
        timestamp: Date.now()
      }
    }

    #getPathBounds(points) {
      let minX = Infinity, minY = Infinity
      let maxX = -Infinity, maxY = -Infinity
      
      for (const point of points) {
        minX = Math.min(minX, point.x)
        minY = Math.min(minY, point.y)
        maxX = Math.max(maxX, point.x)
        maxY = Math.max(maxY, point.y)
      }
      
      return { minX, minY, maxX, maxY }
    }

    #isRectangularPath(points, bounds) {
      // Check if path roughly follows rectangle edges
      const corners = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY }
      ]
      
      // Sample points from the path and check if they're close to rectangle edges
      const sampleSize = Math.min(20, Math.floor(points.length / 4))
      const samples = []
      
      for (let i = 0; i < sampleSize; i++) {
        const index = Math.floor((i / sampleSize) * points.length)
        samples.push(points[index])
      }
      
      let edgeAlignedPoints = 0
      const tolerance = 15
      
      for (const point of samples) {
        const distToLeft = Math.abs(point.x - bounds.minX)
        const distToRight = Math.abs(point.x - bounds.maxX)
        const distToTop = Math.abs(point.y - bounds.minY)
        const distToBottom = Math.abs(point.y - bounds.maxY)
        
        const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom)
        if (minDist < tolerance) {
          edgeAlignedPoints++
        }
      }
      
      return edgeAlignedPoints / samples.length > 0.6
    }

    #isCircularPath(points, bounds) {
      // Check if path roughly follows a circle
      const centerX = (bounds.minX + bounds.maxX) / 2
      const centerY = (bounds.minY + bounds.maxY) / 2
      const expectedRadius = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2
      
      const sampleSize = Math.min(20, Math.floor(points.length / 3))
      let radiusVariance = 0
      
      for (let i = 0; i < sampleSize; i++) {
        const index = Math.floor((i / sampleSize) * points.length)
        const point = points[index]
        const distance = Math.sqrt(
          Math.pow(point.x - centerX, 2) + Math.pow(point.y - centerY, 2)
        )
        radiusVariance += Math.abs(distance - expectedRadius)
      }
      
      const avgVariance = radiusVariance / sampleSize
      return avgVariance < expectedRadius * 0.3
    }

    // Public API
    clear() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      this.paths = []
      this.components = []
      this.currentPath = []
    }

    setTool(tool) {
      this.tool = tool
      this.canvas.style.cursor = tool === 'eraser' ? 'grab' : 'crosshair'
    }

    setStrokeColor(color) {
      this.strokeColor = color
    }

    setStrokeWidth(width) {
      this.strokeWidth = Math.max(1, Math.min(20, width))
    }

    getElement() {
      return this.canvas
    }

    getComponents() {
      return [...this.components]
    }

    getPaths() {
      return [...this.paths]
    }

    exportData() {
      return {
        width: this.width,
        height: this.height,
        paths: this.paths,
        components: this.components,
        timestamp: Date.now()
      }
    }

    importData(data) {
      if (!data) return
      
      this.clear()
      this.paths = data.paths || []
      this.components = data.components || []
      
      // Redraw all paths
      this.#redrawCanvas()
    }

    #redrawCanvas() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      
      for (const path of this.paths) {
        if (path.points.length < 2) continue
        
        this.ctx.beginPath()
        this.ctx.strokeStyle = path.color || this.strokeColor
        this.ctx.lineWidth = path.width || this.strokeWidth
        
        if (path.tool === 'eraser') {
          this.ctx.globalCompositeOperation = 'destination-out'
        } else {
          this.ctx.globalCompositeOperation = 'source-over'
        }
        
        this.ctx.moveTo(path.points[0].x, path.points[0].y)
        for (let i = 1; i < path.points.length; i++) {
          this.ctx.lineTo(path.points[i].x, path.points[i].y)
        }
        this.ctx.stroke()
      }
      
      // Reset to default composition mode
      this.ctx.globalCompositeOperation = 'source-over'
    }

    // Generate placeholder code for components
    generateUICode() {
      if (this.components.length === 0) {
        return "# No UI components detected\npass"
      }
      
      let code = "# Auto-generated UI code\n"
      code += "from modules.ui_framework import *\n\n"
      code += "# Initialize UI components\n"
      code += "components = []\n\n"
      
      for (const component of this.components) {
        switch (component.type) {
          case 'button':
            code += `# Button component\n`
            code += `button_${component.id} = create_button(\n`
            code += `    text="${component.properties.text || 'Button'}",\n`
            code += `    x=${Math.round(component.bounds.minX)},\n`
            code += `    y=${Math.round(component.bounds.minY)},\n`
            code += `    width=${Math.round(component.bounds.maxX - component.bounds.minX)},\n`
            code += `    height=${Math.round(component.bounds.maxY - component.bounds.minY)}\n`
            code += `)\n`
            code += `components.append(button_${component.id})\n\n`
            break
            
          case 'text_input':
            code += `# Text input component\n`
            code += `input_${component.id} = create_text_input(\n`
            code += `    placeholder="${component.properties.placeholder || 'Enter text...'}",\n`
            code += `    x=${Math.round(component.bounds.minX)},\n`
            code += `    y=${Math.round(component.bounds.minY)},\n`
            code += `    width=${Math.round(component.bounds.maxX - component.bounds.minX)},\n`
            code += `    height=${Math.round(component.bounds.maxY - component.bounds.minY)}\n`
            code += `)\n`
            code += `components.append(input_${component.id})\n\n`
            break
            
          case 'panel':
            code += `# Panel component\n`
            code += `panel_${component.id} = create_panel(\n`
            code += `    x=${Math.round(component.bounds.minX)},\n`
            code += `    y=${Math.round(component.bounds.minY)},\n`
            code += `    width=${Math.round(component.bounds.maxX - component.bounds.minX)},\n`
            code += `    height=${Math.round(component.bounds.maxY - component.bounds.minY)}\n`
            code += `)\n`
            code += `components.append(panel_${component.id})\n\n`
            break
            
          case 'radio_button':
            code += `# Radio button component\n`
            code += `radio_${component.id} = create_radio_button(\n`
            code += `    checked=${component.properties.checked ? 'True' : 'False'},\n`
            code += `    x=${Math.round(component.bounds.minX)},\n`
            code += `    y=${Math.round(component.bounds.minY)}\n`
            code += `)\n`
            code += `components.append(radio_${component.id})\n\n`
            break
            
          default:
            code += `# Custom shape component\n`
            code += `custom_${component.id} = create_custom_shape(\n`
            code += `    # Custom drawing data would go here\n`
            code += `)\n`
            code += `components.append(custom_${component.id})\n\n`
        }
      }
      
      code += `# Render the UI\n`
      code += `render_ui(components)\n\n`
      code += `# Return components for further processing\n`
      code += `# components\n`
      
      return code
    }
  }

  window.UIDrawingCanvas = UIDrawingCanvas
  console.log('[UIDrawingCanvas] Class loaded and available')
})()
