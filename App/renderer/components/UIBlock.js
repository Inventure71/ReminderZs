;(function () {
  class UIBlock {
    constructor(blockData) {
      console.log('[UIBlock] Creating UI block with data:', blockData)
      this.data = this.#normalizeData(blockData)
      this.drawingCanvas = null
      this.toolsContainer = null
      this.componentsContainer = null
      this.isExpanded = true
      
      this.el = this.#render()
      this.#setupDrawingCanvas()
      this.#setupTools()
      this.#enableDragging()
      
      console.log('[UIBlock] UI block created successfully')
    }

    #normalizeData(d) {
      return {
        id: d.id || 'UI',
        uid: d.uid || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('ui-' + Math.random().toString(36).slice(2))),
        content: d.content || 'UI Designer',
        button_class: 'UI',
        has_input_executor: Boolean(d.has_input_executor !== false),
        has_output_executor: Boolean(d.has_output_executor !== false),
        exec_input_nodes: d.exec_input_nodes || ['in'],
        exec_output_nodes: d.exec_output_nodes || ['out'],
        variables_input_nodes: d.variables_input_nodes || [],
        variables_input_nodes_types: d.variables_input_nodes_types || [],
        variables_output_nodes: d.variables_output_nodes || ['ui_code'],
        variables_output_nodes_types: d.variables_output_nodes_types || ['str'],
        function_name: d.function_name || null,
        extra_context_string: d.extra_context_string || null,
        inline_values: d.inline_values || {},
        // UI-specific data
        drawing_data: d.drawing_data || null,
        canvas_width: d.canvas_width || 400,
        canvas_height: d.canvas_height || 300
      }
    }

    #render() {
      const block = document.createElement('div')
      block.className = 'block ui-block'
      block.dataset.blockId = this.data.id
      block.dataset.blockUid = this.data.uid
      
      // Header
      const header = this.#renderHeader()
      block.appendChild(header)
      
      // Body with drawing canvas and tools
      const body = this.#renderBody()
      block.appendChild(body)
      
      // Exec ports
      this.#renderExecPorts(block)
      
      return block
    }

    #renderHeader() {
      const header = document.createElement('div')
      header.className = 'block-header'
      
      const title = document.createElement('div')
      title.className = 'block-title'
      title.textContent = this.data.id || 'UI Designer'
      
      const right = document.createElement('div')
      right.className = 'block-right'
      
      // UI badge
      const badge = document.createElement('span')
      badge.className = 'badge ui'
      badge.textContent = 'UI'
      badge.style.cssText = 'color: #fff; background: linear-gradient(45deg, #c6a0f6, #b088e8); box-shadow: 0 2px 8px rgba(198,160,246,0.3);'
      
      // UID
      const uid = document.createElement('div')
      uid.className = 'block-uid'
      uid.textContent = '#' + (this.data.uid || '').slice(0, 8)
      
      // Toggle button
      const toggleBtn = document.createElement('button')
      toggleBtn.className = 'ui-toggle-btn'
      toggleBtn.textContent = '−'
      toggleBtn.title = 'Toggle drawing canvas'
      toggleBtn.style.cssText = 'width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel); color: var(--text); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; margin-right: 4px;'
      
      toggleBtn.addEventListener('pointerdown', (e) => e.stopPropagation())
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.#toggleCanvas()
      })
      
      // Delete button
      const deleteBtn = document.createElement('button')
      deleteBtn.className = 'block-del'
      deleteBtn.textContent = '×'
      deleteBtn.title = 'Delete block'
      deleteBtn.style.cssText = 'width: 24px; height: 24px; border-radius: 6px; border: 1px solid rgba(42,47,69,0.8); background: rgba(26,31,46,0.8); color: var(--muted); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;'
      
      deleteBtn.addEventListener('pointerdown', (e) => e.stopPropagation())
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const event = new CustomEvent('block:delete', { 
          bubbles: true, 
          detail: { uid: this.data.uid } 
        })
        this.el.dispatchEvent(event)
      })
      
      right.appendChild(badge)
      right.appendChild(uid)
      right.appendChild(toggleBtn)
      right.appendChild(deleteBtn)
      
      header.appendChild(title)
      header.appendChild(right)
      
      return header
    }

    #renderBody() {
      console.log('[UIBlock] Rendering body...')
      
      const body = document.createElement('div')
      body.className = 'block-body ui-block-body'
      
      // Force the layout with inline styles to override any CSS conflicts
      body.style.cssText = `
        display: flex !important; 
        flex-direction: column !important; 
        padding: 14px !important; 
        gap: 12px !important; 
        min-width: 420px !important; 
        grid-template-columns: none !important;
      `
      
      // Drawing canvas container
      const canvasContainer = document.createElement('div')
      canvasContainer.className = 'ui-canvas-container'
      canvasContainer.style.cssText = `
        display: flex; 
        flex-direction: column; 
        gap: 8px; 
        padding: 8px; 
        border-radius: 6px;
      `
      
      // Tools container
      this.toolsContainer = document.createElement('div')
      this.toolsContainer.className = 'ui-tools'
      this.toolsContainer.style.cssText = `
        display: flex; 
        align-items: center; 
        gap: 8px; 
        padding: 8px; 
        background: rgba(0,0,0,0.3); 
        border-radius: 6px; 
        border: 2px solid var(--accent);
        flex-wrap: wrap;
      `
      
      const toolsLabel = document.createElement('span')
      toolsLabel.textContent = '🛠️ Tools:'
      toolsLabel.style.cssText = 'color: var(--text); font-weight: bold; margin-right: 8px;'
      this.toolsContainer.appendChild(toolsLabel)
      
      // Canvas placeholder (will be replaced with actual canvas)
      const canvasPlaceholder = document.createElement('div')
      canvasPlaceholder.className = 'ui-canvas-placeholder'
      canvasPlaceholder.style.cssText = `
        width: ${this.data.canvas_width}px !important; 
        height: ${this.data.canvas_height}px !important; 
        border: 3px solid var(--accent) !important; 
        border-radius: 8px !important; 
        background: #0a0c10 !important; 
        display: flex !important; 
        align-items: center !important; 
        justify-content: center !important; 
        color: var(--accent) !important; 
        font-size: 16px !important;
        font-weight: bold !important;
        text-align: center !important;
        margin: 8px 0 !important;
      `
      canvasPlaceholder.innerHTML = '🖊️<br/>DRAWING CANVAS<br/>Loading...'
      
      console.log('[UIBlock] Canvas placeholder created:', canvasPlaceholder)
      
      // Components list
      this.componentsContainer = document.createElement('div')
      this.componentsContainer.className = 'ui-components-list'
      this.componentsContainer.style.cssText = `
        max-height: 120px; 
        overflow-y: auto; 
        border: 1px solid var(--border); 
        border-radius: 6px; 
        background: rgba(0,0,0,0.1); 
        padding: 8px;
        display: none;
      `
      
      const componentsTitle = document.createElement('div')
      componentsTitle.style.cssText = 'font-size: 12px; color: var(--muted); margin-bottom: 6px; font-weight: 500;'
      componentsTitle.textContent = 'Detected Components:'
      this.componentsContainer.appendChild(componentsTitle)
      
      canvasContainer.appendChild(this.toolsContainer)
      canvasContainer.appendChild(canvasPlaceholder)
      canvasContainer.appendChild(this.componentsContainer)
      
      body.appendChild(canvasContainer)
      
      // Variable ports (output for generated UI code)
      const outputsWrap = document.createElement('div')
      outputsWrap.className = 'block-ports outputs'
      outputsWrap.style.cssText = 'display: flex; flex-direction: column; gap: 8px; align-self: flex-end; margin-top: 12px;'
      
      const outPort = this.#renderVarPort('ui_code', 'str', 'out', 0)
      outputsWrap.appendChild(outPort)
      
      body.appendChild(outputsWrap)
      
      console.log('[UIBlock] Body rendered successfully')
      return body
    }

    #renderVarPort(label, type, side, index) {
      const port = document.createElement('div')
      port.className = `port port-${side}`
      port.dataset.port = 'var'
      port.dataset.direction = side
      port.dataset.index = String(index)
      
      const dot = document.createElement('div')
      dot.className = 'port-dot'
      
      const name = document.createElement('div')
      name.className = 'port-name'
      name.textContent = label || ''
      name.style.fontSize = '12px'
      
      const typeEl = document.createElement('code')
      typeEl.className = 'port-type'
      typeEl.textContent = type || ''
      
      const dir = document.createElement('span')
      dir.className = 'port-dir'
      dir.textContent = side.toUpperCase()
      
      if (side === 'out') {
        port.appendChild(typeEl)
        port.appendChild(name)
        port.appendChild(dir)
        port.appendChild(dot)
      }
      
      port.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 4px 8px; border: 1px solid transparent; border-radius: 6px; transition: all 0.15s ease;'
      
      return port
    }

    #renderExecPorts(block) {
      const body = block.querySelector('.block-body')
      
      // Exec input
      if (this.data.has_input_executor) {
        this.data.exec_input_nodes.forEach((key, idx) => {
          const el = this.#renderExecutorPort('in', key, idx)
          el.style.left = '-8px'
          el.style.top = `${-8 + idx * 20}px`
          body.appendChild(el)
        })
      }
      
      // Exec output
      if (this.data.has_output_executor) {
        this.data.exec_output_nodes.forEach((key, idx) => {
          const el = this.#renderExecutorPort('out', key, idx)
          el.style.right = '-8px'
          el.style.top = `${-8 + idx * 20}px`
          body.appendChild(el)
        })
      }
    }

    #renderExecutorPort(kind, key, idx) {
      const el = document.createElement('div')
      el.className = `exec ${kind}`
      el.dataset.port = 'exec'
      el.dataset.direction = kind
      if (key != null) el.dataset.execKey = String(key)
      if (idx != null) el.dataset.execIndex = String(idx)
      el.title = (kind === 'in' ? 'Exec In' : 'Exec Out') + (key ? ` (${key})` : '')
      
      el.style.cssText = `
        position: absolute; 
        width: 16px; 
        height: 16px; 
        border-radius: 50%; 
        background: linear-gradient(45deg, var(--red), #e07a9a); 
        border: 2px solid rgba(0,0,0,0.3); 
        box-shadow: 0 2px 6px rgba(242,143,173,0.4); 
        transition: all 0.15s ease; 
        cursor: pointer;
      `
      
      return el
    }

    #setupDrawingCanvas() {
      // Replace placeholder with actual drawing canvas
      setTimeout(() => {
        const placeholder = this.el.querySelector('.ui-canvas-placeholder')
        console.log('[UIBlock] Setting up drawing canvas, placeholder found:', !!placeholder, 'UIDrawingCanvas available:', !!window.UIDrawingCanvas)
        
        if (placeholder && window.UIDrawingCanvas) {
          try {
            console.log('[UIBlock] Creating UIDrawingCanvas with dimensions:', this.data.canvas_width, 'x', this.data.canvas_height)
            
            this.drawingCanvas = new window.UIDrawingCanvas(
              this.data.canvas_width, 
              this.data.canvas_height
            )
            
            console.log('[UIBlock] Drawing canvas created successfully:', this.drawingCanvas)
            console.log('[UIBlock] Canvas element:', this.drawingCanvas.getElement())
            
            // Set up event listeners
            this.drawingCanvas.getElement().addEventListener('ui-drawing:path-complete', (e) => {
              console.log('[UIBlock] Path completed:', e.detail)
              this.#updateComponentsList(e.detail.components)
              this.#updateOutputData()
            })
            
            // Make sure the canvas element has the right styling
            const canvasEl = this.drawingCanvas.getElement()
            canvasEl.style.display = 'block'
            canvasEl.style.cursor = 'crosshair'
            
            console.log('[UIBlock] Replacing placeholder with canvas...')
            placeholder.parentNode.replaceChild(canvasEl, placeholder)
            console.log('[UIBlock] Canvas replacement complete')
            
            // Verify the canvas is in the DOM and visible
            setTimeout(() => {
              const foundCanvas = this.el.querySelector('.ui-drawing-canvas')
              console.log('[UIBlock] Canvas verification - found in DOM:', !!foundCanvas)
              if (foundCanvas) {
                console.log('[UIBlock] Canvas dimensions:', foundCanvas.offsetWidth, 'x', foundCanvas.offsetHeight)
                console.log('[UIBlock] Canvas style:', foundCanvas.style.cssText)
                
                // Test if canvas is responsive to clicks
                foundCanvas.addEventListener('click', (e) => {
                  console.log('[UIBlock] Canvas clicked at:', e.offsetX, e.offsetY)
                })
              }
            }, 50)
            
            // Load existing drawing data if available
            if (this.data.drawing_data) {
              this.drawingCanvas.importData(this.data.drawing_data)
              this.#updateComponentsList(this.drawingCanvas.getComponents())
            }
            
            console.log('[UIBlock] Drawing canvas setup complete')
          } catch (error) {
            console.error('[UIBlock] Error setting up drawing canvas:', error)
            console.error(error.stack)
          }
        } else {
          console.error('[UIBlock] Cannot setup drawing canvas - placeholder:', !!placeholder, 'UIDrawingCanvas:', !!window.UIDrawingCanvas)
          
          // If UIDrawingCanvas is not available, show an error message
          if (placeholder && !window.UIDrawingCanvas) {
            placeholder.innerHTML = '❌<br/>UIDrawingCanvas not loaded<br/>Check console for errors'
            placeholder.style.color = 'var(--red)'
            placeholder.style.border = '2px solid var(--red)'
          }
        }
      }, 500) // Increased timeout to ensure everything is loaded
    }

    #setupTools() {
      const tools = [
        { name: 'pen', icon: '✏️', title: 'Pen tool' },
        { name: 'eraser', icon: '🧹', title: 'Eraser tool' },
        { name: 'clear', icon: '🗑️', title: 'Clear all' }
      ]
      
      tools.forEach(tool => {
        const btn = document.createElement('button')
        btn.className = `ui-tool-btn ${tool.name === 'pen' ? 'active' : ''}`
        btn.textContent = tool.icon
        btn.title = tool.title
        btn.dataset.tool = tool.name
        
        btn.style.cssText = `
          padding: 6px 10px; 
          border: 1px solid var(--border); 
          border-radius: 4px; 
          background: var(--panel); 
          color: var(--text); 
          cursor: pointer; 
          font-size: 14px; 
          transition: all 0.15s ease;
        `
        
        btn.addEventListener('pointerdown', (e) => e.stopPropagation())
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          this.#handleToolClick(tool.name, btn)
        })
        
        this.toolsContainer.appendChild(btn)
      })
      
      // Color picker
      const colorPicker = document.createElement('input')
      colorPicker.type = 'color'
      colorPicker.value = '#7aa2f7'
      colorPicker.title = 'Stroke color'
      colorPicker.style.cssText = `
        width: 32px; 
        height: 28px; 
        border: 1px solid var(--border); 
        border-radius: 4px; 
        background: var(--panel); 
        cursor: pointer;
      `
      
      colorPicker.addEventListener('pointerdown', (e) => e.stopPropagation())
      colorPicker.addEventListener('change', (e) => {
        if (this.drawingCanvas) {
          this.drawingCanvas.setStrokeColor(e.target.value)
        }
      })
      
      this.toolsContainer.appendChild(colorPicker)
      
      // Stroke width
      const widthSlider = document.createElement('input')
      widthSlider.type = 'range'
      widthSlider.min = '1'
      widthSlider.max = '10'
      widthSlider.value = '2'
      widthSlider.title = 'Stroke width'
      widthSlider.style.cssText = `
        width: 60px; 
        cursor: pointer;
      `
      
      widthSlider.addEventListener('pointerdown', (e) => e.stopPropagation())
      widthSlider.addEventListener('input', (e) => {
        if (this.drawingCanvas) {
          this.drawingCanvas.setStrokeWidth(parseInt(e.target.value))
        }
      })
      
      this.toolsContainer.appendChild(widthSlider)
    }

    #handleToolClick(toolName, btn) {
      if (toolName === 'clear') {
        if (this.drawingCanvas) {
          this.drawingCanvas.clear()
          this.#updateComponentsList([])
          this.#updateOutputData()
        }
        return
      }
      
      // Update active tool
      this.toolsContainer.querySelectorAll('.ui-tool-btn').forEach(b => {
        b.classList.remove('active')
        b.style.background = 'var(--panel)'
      })
      
      btn.classList.add('active')
      btn.style.background = 'rgba(122,162,247,0.2)'
      
      if (this.drawingCanvas) {
        this.drawingCanvas.setTool(toolName)
      }
    }

    #updateComponentsList(components) {
      const container = this.componentsContainer
      
      // Clear existing components (except title)
      const title = container.querySelector('div')
      container.innerHTML = ''
      if (title) container.appendChild(title)
      
      if (components.length === 0) {
        container.style.display = 'none'
        return
      }
      
      container.style.display = 'block'
      
      components.forEach(component => {
        const item = document.createElement('div')
        item.style.cssText = `
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          padding: 4px 6px; 
          margin-bottom: 4px; 
          background: rgba(122,162,247,0.1); 
          border-radius: 4px; 
          font-size: 11px;
        `
        
        const info = document.createElement('span')
        info.textContent = `${component.type} (${Math.round(component.bounds.maxX - component.bounds.minX)}×${Math.round(component.bounds.maxY - component.bounds.minY)})`
        info.style.color = 'var(--text)'
        
        const badge = document.createElement('span')
        badge.textContent = component.type.replace('_', ' ').toUpperCase()
        badge.style.cssText = `
          background: var(--accent); 
          color: white; 
          padding: 2px 4px; 
          border-radius: 2px; 
          font-size: 9px; 
          font-weight: 500;
        `
        
        item.appendChild(info)
        item.appendChild(badge)
        container.appendChild(item)
      })
    }

    #updateOutputData() {
      if (!this.drawingCanvas) return
      
      // Store drawing data
      this.data.drawing_data = this.drawingCanvas.exportData()
      
      // Generate UI code and store as inline value for output
      const uiCode = this.drawingCanvas.generateUICode()
      this.data.inline_values['0'] = uiCode
      
      // Dispatch data update event
      const event = new CustomEvent('ui-block:data-updated', {
        detail: { 
          uid: this.data.uid,
          drawingData: this.data.drawing_data,
          generatedCode: uiCode
        }
      })
      this.el.dispatchEvent(event)
    }

    #toggleCanvas() {
      const canvasElement = this.drawingCanvas?.getElement()
      const componentsContainer = this.componentsContainer
      const toggleBtn = this.el.querySelector('.ui-toggle-btn')
      
      if (!canvasElement) return
      
      this.isExpanded = !this.isExpanded
      
      if (this.isExpanded) {
        canvasElement.style.display = 'block'
        if (this.drawingCanvas && this.drawingCanvas.getComponents().length > 0) {
          componentsContainer.style.display = 'block'
        }
        toggleBtn.textContent = '−'
        toggleBtn.title = 'Collapse drawing canvas'
      } else {
        canvasElement.style.display = 'none'
        componentsContainer.style.display = 'none'
        toggleBtn.textContent = '+'
        toggleBtn.title = 'Expand drawing canvas'
      }
    }

    #enableDragging() {
      let isDragging = false
      let startX = 0
      let startY = 0
      let startLeft = 0
      let startTop = 0

      const onPointerDown = (e) => {
        if (e.button !== 0) return
        
        // Don't start dragging if clicking on canvas or tools
        if (e.target.closest('.ui-drawing-canvas') || 
            e.target.closest('.ui-tools') ||
            e.target.closest('.ui-components-list')) {
          return
        }
        
        // Handle Ctrl+click for selection
        if (e.ctrlKey || e.metaKey) {
          e.stopPropagation()
          const uid = this.data.uid
          if (window.Store && window.Store.selectedBlocks) {
            if (window.Store.selectedBlocks.has(uid)) {
              window.deselectBlock(uid)
            } else {
              window.selectBlock(uid, true)
            }
          }
          return
        }
        
        // Handle selection for dragging
        const uid = this.data.uid
        if (window.Store && window.Store.selectedBlocks) {
          if (!window.Store.selectedBlocks.has(uid)) {
            window.selectBlock(uid, false)
          }
        }
        
        isDragging = true
        this.el.classList.add('dragging')
        this.el.setPointerCapture(e.pointerId)
        startX = e.clientX
        startY = e.clientY
        
        startLeft = parseFloat(this.el.style.left) || 0
        startTop = parseFloat(this.el.style.top) || 0
      }

      const onPointerMove = (e) => {
        if (!isDragging) return
        
        const canvasContent = this.el.parentElement
        const transform = this.#getCanvasTransform(canvasContent)
        
        const dx = (e.clientX - startX) / transform.scale
        const dy = (e.clientY - startY) / transform.scale
        
        const left = startLeft + dx
        const top = startTop + dy
        this.el.style.left = `${left}px`
        this.el.style.top = `${top}px`
        
        const event = new CustomEvent('block:moved', { 
          bubbles: true, 
          detail: { id: this.data.id || '' } 
        })
        this.el.dispatchEvent(event)
      }

      const onPointerUp = (e) => {
        isDragging = false
        this.el.classList.remove('dragging')
        try { this.el.releasePointerCapture(e.pointerId) } catch (_) {}
      }

      this.el.addEventListener('pointerdown', onPointerDown)
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    }

    #getCanvasTransform(el) {
      const style = window.getComputedStyle(el)
      const transform = style.transform
      
      if (transform === 'none') {
        return { x: 0, y: 0, scale: 1 }
      }
      
      const matrix = transform.match(/matrix\(([^)]+)\)/)
      if (matrix) {
        const values = matrix[1].split(',').map(parseFloat)
        return { x: values[4] || 0, y: values[5] || 0, scale: values[0] || 1 }
      }
      
      return { x: 0, y: 0, scale: 1 }
    }

    // Public API
    setPosition(x, y) {
      this.el.style.left = `${x}px`
      this.el.style.top = `${y}px`
    }

    render(parent) {
      if (parent) {
        parent.appendChild(this.el)
      }
      return this.el
    }

    getData() {
      return { ...this.data }
    }
  }

  window.UIBlock = UIBlock
  console.log('[UIBlock] Class loaded and available')
})()
