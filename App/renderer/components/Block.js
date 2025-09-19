;(function () {
  function createElement(tagName, className, children) {
    const el = document.createElement(tagName)
    if (className) el.className = className
    if (children && children.length) children.forEach((c) => el.appendChild(c))
    return el
  }

  function createText(text) {
    return document.createTextNode(text)
  }

  class BlockView {
    constructor(blockData) {
      this.data = BlockView.normalize(blockData)
      this.el = this.#render()
      this.#enableDragging()
    }

    static normalize(d) {
      return {
        id: d.id || '', // class/type id
        uid: d.uid || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('uid-' + Math.random().toString(36).slice(2))),
        content: d.content || '',
        button_class: d.button_class || null, // Executor | Function | Variable | Conditional
        has_input_executor: Boolean(d.has_input_executor),
        has_output_executor: Boolean(d.has_output_executor),
        exec_input_nodes: Array.isArray(d.exec_input_nodes)
          ? d.exec_input_nodes
          : (d.has_input_executor ? ['in'] : []),
        exec_output_nodes: Array.isArray(d.exec_output_nodes)
          ? d.exec_output_nodes
          : ((d.has_output_executor && (d.button_class || '').toLowerCase() === 'conditional')
              ? ['then', 'else']
              : (d.has_output_executor ? ['out'] : [])),
        // accept legacy fields with "notes" if present, but prefer "nodes"
        variables_input_nodes: Array.isArray(d.variables_input_nodes) ? d.variables_input_nodes : (Array.isArray(d.variables_input_notes) ? d.variables_input_notes : []),
        variables_input_nodes_types: Array.isArray(d.variables_input_nodes_types) ? d.variables_input_nodes_types : (Array.isArray(d.variables_input_notes_types) ? d.variables_input_notes_types : []),
        variables_output_nodes: Array.isArray(d.variables_output_nodes) ? d.variables_output_nodes : (Array.isArray(d.variables_output_notes) ? d.variables_output_notes : []),
        variables_output_nodes_types: Array.isArray(d.variables_output_nodes_types) ? d.variables_output_nodes_types : (Array.isArray(d.variables_output_notes_types) ? d.variables_output_notes_types : []),
        function_name: d.function_name || null,
        extra_context_string: d.extra_context_string || null,
        // variable-specific (for Variable blocks): single UID for output variable
        variable_uid: d.variable_uid || null,
        // Inline values for unconnected input ports (indexed by port index)
        inline_values: d.inline_values || {}
      }
    }

    static constrainByClass(data) {
      if ((data.button_class || '').toLowerCase() === 'variable') {
        // Check if it's a SetVariable block
        const isSet = String(data.id || '').toLowerCase() === 'setvariable'
        
        if (isSet) {
          // Set Variable: has exec in/out, one variable input, no variable outputs
          data.has_input_executor = true
          data.has_output_executor = true
          data.exec_input_nodes = Array.isArray(data.exec_input_nodes) && data.exec_input_nodes.length ? data.exec_input_nodes : ['in']
          data.exec_output_nodes = Array.isArray(data.exec_output_nodes) && data.exec_output_nodes.length ? data.exec_output_nodes : ['out']
          data.variables_input_nodes = ['value']
          data.variables_input_nodes_types = [(data.variables_input_nodes_types && data.variables_input_nodes_types[0]) || 'any']
          data.variables_output_nodes = []
          data.variables_output_nodes_types = []
        } else {
          // Get Variable: no exec pins, single variable output
          data.has_input_executor = false
          data.has_output_executor = false
          data.variables_input_nodes = []
          data.variables_input_nodes_types = []
          // ensure exactly one output var
          const name = data.variables_output_nodes && data.variables_output_nodes[0] ? data.variables_output_nodes[0] : 'value'
          const type = data.variables_output_nodes_types && data.variables_output_nodes_types[0] ? data.variables_output_nodes_types[0] : 'any'
          data.variables_output_nodes = [name]
          data.variables_output_nodes_types = [type]
        }
      } else if ((data.button_class || '').toLowerCase() === 'operator') {
        // Operators: no exec pins, only variable inputs and outputs
        data.has_input_executor = false
        data.has_output_executor = false
        data.exec_input_nodes = []
        data.exec_output_nodes = []
        // Keep variable inputs and outputs as defined
      }
      return data
    }

    #renderVarPort(label, type, side, index) {
      const port = createElement('div', `port port-${side}`)
      port.dataset.port = 'var'
      port.dataset.direction = side
      port.dataset.index = String(index)
      const dot = createElement('div', 'port-dot')
      const name = createElement('div', 'port-name', [createText(label || '')])
      const typeEl = createElement('code', 'port-type', [createText(type || '')])
      const dir = createElement('span', 'port-dir', [createText(side.toUpperCase())])
      
      if (side === 'in') {
        port.appendChild(dot)
        port.appendChild(dir)
        port.appendChild(name)
        port.appendChild(typeEl)
        
        // Add inline input field for default types when not connected
        if (this.#shouldShowInlineInput(type, side, index)) {
          const inlineInput = this.#createInlineInput(type, index)
          port.appendChild(inlineInput)
        }
      } else {
        // out: right side emphasis
        port.appendChild(typeEl)
        port.appendChild(name)
        port.appendChild(dir)
        port.appendChild(dot)
      }
      return port
    }
    
    #shouldShowInlineInput(type, side, index) {
      // Only show for input ports with default types
      if (side !== 'in') return false
      
      const normalizedType = (type || '').toLowerCase()
      const defaultTypes = ['bool', 'boolean', 'int', 'integer', 'float', 'double', 'number', 'str', 'string', 'any']
      
      return defaultTypes.includes(normalizedType)
    }
    
    #createInlineInput(type, index) {
      const wrapper = createElement('div', 'port-inline-input')
      const input = createElement('input', 'inline-value-input')
      
      const normalizedType = (type || '').toLowerCase()
      
      // Set input type and placeholder based on variable type
      switch (normalizedType) {
        case 'bool':
        case 'boolean':
          input.type = 'checkbox'
          input.checked = this.data.inline_values[index] === 'true' || this.data.inline_values[index] === true
          break
        case 'int':
        case 'integer':
          input.type = 'number'
          input.step = '1'
          input.placeholder = '0'
          input.value = this.data.inline_values[index] || ''
          break
        case 'float':
        case 'double':
        case 'number':
          input.type = 'number'
          input.step = 'any'
          input.placeholder = '0.0'
          input.value = this.data.inline_values[index] || ''
          break
        case 'str':
        case 'string':
          input.type = 'text'
          input.placeholder = '""'
          input.value = this.data.inline_values[index] || ''
          break
        case 'any':
        default:
          input.type = 'text'
          input.placeholder = 'value'
          input.value = this.data.inline_values[index] || ''
      }
      
      // Prevent dragging from starting when interacting with input
      input.addEventListener('pointerdown', (e) => { 
        e.stopPropagation() 
        // Allow the input to receive focus
        setTimeout(() => input.focus(), 0)
      })
      input.addEventListener('mousedown', (e) => { e.stopPropagation() })
      input.addEventListener('click', (e) => { 
        e.stopPropagation()
        input.focus()
      })
      
      // Ensure input can be selected and edited
      input.addEventListener('focus', (e) => { e.stopPropagation() })
      input.addEventListener('keydown', (e) => { e.stopPropagation() })
      input.addEventListener('keyup', (e) => { e.stopPropagation() })
      
      // Update inline value when input changes
      input.addEventListener('input', (e) => {
        let value = e.target.value
        let isValid = true
        
        // Type-specific validation and conversion
        switch (normalizedType) {
          case 'bool':
          case 'boolean':
            value = e.target.checked
            break
          case 'int':
          case 'integer':
            if (value !== '') {
              const intVal = parseInt(value, 10)
              if (isNaN(intVal)) {
                isValid = false
                input.style.borderColor = 'var(--red)'
              } else {
                value = intVal
                input.style.borderColor = ''
              }
            }
            break
          case 'float':
          case 'double':
          case 'number':
            if (value !== '') {
              const floatVal = parseFloat(value)
              if (isNaN(floatVal)) {
                isValid = false
                input.style.borderColor = 'var(--red)'
              } else {
                value = floatVal
                input.style.borderColor = ''
              }
            }
            break
          case 'str':
          case 'string':
          case 'any':
            // Strings and any type are always valid
            input.style.borderColor = ''
            break
          default:
            input.style.borderColor = ''
        }
        
        if (isValid) {
          this.data.inline_values[index] = value
          
          // Dispatch event to notify of value change
          const event = new CustomEvent('block:inline-value-changed', {
            bubbles: true,
            detail: { uid: this.data.uid, index, value, type: normalizedType }
          })
          this.el.dispatchEvent(event)
        }
      })
      
      wrapper.appendChild(input)
      return wrapper
    }

    #renderExecutorPort(kind, key, idx) {
      const el = createElement('div', `exec ${kind}`)
      el.dataset.port = 'exec'
      el.dataset.direction = kind
      if (key != null) el.dataset.execKey = String(key)
      if (idx != null) el.dataset.execIndex = String(idx)
      el.title = (kind === 'in' ? 'Exec In' : 'Exec Out') + (key ? ` (${key})` : '')
      return el
    }

    #renderHeader() {
      const title = createElement('div', 'block-title', [createText(this.data.id || '(unnamed)')])
      const uid = createElement('div', 'block-uid', [createText('#' + (this.data.uid || '').slice(0, 8))])
      const badgeText = this.data.button_class || 'Block'
      const badge = createElement('span', `badge ${badgeText.toLowerCase()}`, [createText(badgeText)])
      const del = createElement('button', 'block-del', [createText('×')])
      del.type = 'button'
      del.title = 'Delete block'
      // prevent dragging from starting when clicking delete
      del.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault() })
      del.addEventListener('click', (e) => {
        e.stopPropagation()
        const ev = new CustomEvent('block:delete', { bubbles: true, detail: { uid: this.data.uid } })
        this.el.dispatchEvent(ev)
      })
      // prevent deleting Begin Play
      const isBegin = (this.data.button_class || '').toLowerCase() === 'executor' && ((this.data.id || '').toLowerCase().includes('begin') || (this.data.content || '').toLowerCase().includes('begin'))
      if (isBegin) {
        del.disabled = true
        del.title = 'Cannot delete Begin Play'
      }
      const right = createElement('div', 'block-right', [badge, uid, del])
      return createElement('div', 'block-header', [title, right])
    }

    #renderBody() {
      const inputsWrap = createElement('div', 'block-ports inputs')
      const content = createElement('div', 'block-content', [createText(this.data.content)])
      const outputsWrap = createElement('div', 'block-ports outputs')

      const inNames = this.data.variables_input_nodes
      const inTypes = this.data.variables_input_nodes_types
      for (let i = 0; i < Math.max(inNames.length, inTypes.length); i++) {
        inputsWrap.appendChild(this.#renderVarPort(inNames[i] || '', inTypes[i] || '', 'in', i))
      }

      const outNames = this.data.variables_output_nodes
      const outTypes = this.data.variables_output_nodes_types
      for (let i = 0; i < Math.max(outNames.length, outTypes.length); i++) {
        outputsWrap.appendChild(this.#renderVarPort(outNames[i] || '', outTypes[i] || '', 'out', i))
      }

      // order: inputs (left), content (center), outputs (right)
      return createElement('div', 'block-body', [inputsWrap, content, outputsWrap])
    }

    #render() {
      const block = createElement('div', 'block')

      // apply class constraints (e.g., Variable)
      this.data = BlockView.constrainByClass(this.data)

      const header = this.#renderHeader()
      const body = this.#renderBody()

      block.appendChild(header)
      block.appendChild(body)

      // Exec inputs (left side, vertically stacked)
      this.data.exec_input_nodes.forEach((key, idx) => {
        const el = this.#renderExecutorPort('in', key, idx)
        el.style.left = `-7px`
        el.style.top = `${-7 + idx * 20}px`
        body.appendChild(el)
      })
      // Exec outputs (right side, vertically stacked)
      this.data.exec_output_nodes.forEach((key, idx) => {
        const el = this.#renderExecutorPort('out', key, idx)
        el.style.right = `-7px`
        el.style.top = `${-7 + idx * 20}px`
        body.appendChild(el)
      })

      block.dataset.blockId = this.data.id || ''
      block.dataset.blockUid = this.data.uid || ''

      return block
    }

    #enableDragging() {
      const el = this.el
      let isDragging = false
      let startX = 0
      let startY = 0
      let startLeft = 0
      let startTop = 0

      const onPointerDown = (e) => {
        if (e.button !== 0) return
        
        // Handle Ctrl+click for selection
        if (e.ctrlKey || e.metaKey) {
          e.stopPropagation()
          const uid = this.data.uid
          if (window.Store && window.Store.selectedBlocks) {
            if (window.Store.selectedBlocks.has(uid)) {
              window.deselectBlock(uid)
            } else {
              window.selectBlock(uid, true) // Add to selection
            }
          }
          return
        }
        
        // Handle selection for dragging
        const uid = this.data.uid
        if (window.Store && window.Store.selectedBlocks) {
          if (!window.Store.selectedBlocks.has(uid)) {
            // If this block is not selected, select only this block
            window.selectBlock(uid, false)
          }
          // If already selected, keep the current selection for multi-drag
        }
        
        isDragging = true
        el.classList.add('dragging')
        el.setPointerCapture(e.pointerId)
        startX = e.clientX
        startY = e.clientY
        
        // Get current position directly from CSS (already in canvas coordinates)
        startLeft = parseFloat(el.style.left) || 0
        startTop = parseFloat(el.style.top) || 0
      }

      const onPointerMove = (e) => {
        if (!isDragging) return
        
        // Get canvas transform to account for zoom/pan
        const canvasContent = el.parentElement
        const transform = getCanvasTransform(canvasContent)
        
        // Calculate movement in canvas space (accounting for scale)
        const dx = (e.clientX - startX) / transform.scale
        const dy = (e.clientY - startY) / transform.scale
        
        // Move all selected blocks together
        if (window.Store && window.Store.selectedBlocks.size > 1) {
          // Store initial positions of all blocks if not already stored
          if (!this._initialPositions) {
            this._initialPositions = new Map()
            for (const uid of window.Store.selectedBlocks) {
              const blockInfo = window.Store.blocks.get(uid)
              if (blockInfo && blockInfo.el) {
                const blockEl = blockInfo.el
                this._initialPositions.set(uid, {
                  left: parseFloat(blockEl.style.left) || 0,
                  top: parseFloat(blockEl.style.top) || 0
                })
              }
            }
          }
          
          // Move all blocks by the same delta from their initial positions
          for (const uid of window.Store.selectedBlocks) {
            const blockInfo = window.Store.blocks.get(uid)
            const initialPos = this._initialPositions.get(uid)
            if (blockInfo && blockInfo.el && initialPos) {
              const blockEl = blockInfo.el
              blockEl.style.left = `${initialPos.left + dx}px`
              blockEl.style.top = `${initialPos.top + dy}px`
            }
          }
        } else {
          // Single block movement
          const left = startLeft + dx
          const top = startTop + dy
          el.style.left = `${left}px`
          el.style.top = `${top}px`
        }
        
        // notify canvas for connection line updates
        const ev = new CustomEvent('block:moved', { bubbles: true, detail: { id: this.data.id || '' } })
        el.dispatchEvent(ev)
      }
      
      // Helper function to get canvas transform
      function getCanvasTransform(el) {
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

      const onPointerUp = (e) => {
        isDragging = false
        el.classList.remove('dragging')
        // Clean up initial positions for multi-block movement
        this._initialPositions = null
        try { el.releasePointerCapture(e.pointerId) } catch (_) {}
      }

      el.addEventListener('pointerdown', onPointerDown)
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    }

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
  }

  window.BlockView = BlockView
})()


