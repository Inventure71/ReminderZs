;(function () {
  function qs(sel, root) { return (root || document).querySelector(sel) }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)) }

  // Simple in-memory store for blocks and connections
  const Store = {
    blocks: new Map(), // uid -> { uid, id, el, data }
    // Exec connections: key `${fromUid}:exec:${outKey}` → { toUid, toExecKey?, toExecIndex? }
    exec: new Map(),
    // Variable connections: key `${fromUid}:out:${outIndex}` → Set<{ toUid, inIndex }>
    vars: new Map(),
    // Variables catalogue: varUid → { uid, name, type, value, is_global, global_id, local_id }
    variables: new Map(),
    // Available blocks for search
    availableBlocks: new Map(), // id -> { id, name, type, description, template }
    // Multi-selection state
    selectedBlocks: new Set(), // Set of block UIDs
    selectionBox: null, // { startX, startY, endX, endY } for area selection
  }

const Variables = {
  list: [], // { name, type, value, uid, is_global?, global_id?, local_id? }
}

  function addBlockToStore(uid, el, data) {
    Store.blocks.set(uid, { uid, id: data.id, el, data })
  }

  function removeConnectionsForBlock(uid) {
    // Remove exec connections where this uid is source or target
    for (const [fromKey, val] of Array.from(Store.exec.entries())) {
      if (val && val.toUid === uid) {
        Store.exec.delete(fromKey)
        continue
      }
      if (fromKey.startsWith(uid + ':exec:')) {
        Store.exec.delete(fromKey)
      }
    }
    // Remove any var connections where this uid is source or target
    for (const [key, setRef] of Array.from(Store.vars.entries())) {
      const [fromUid] = key.split(':out:')
      if (fromUid === uid) {
        Store.vars.delete(key)
        continue
      }
      let changed = false
      for (const item of Array.from(setRef)) {
        if (item.toUid === uid) { setRef.delete(item); changed = true }
      }
      if (changed && setRef.size === 0) {
        Store.vars.delete(key)
      }
    }
  }

  // Multi-selection helper functions
  function selectBlock(uid, addToSelection = false) {
    if (!addToSelection) {
      clearSelection()
    }
    Store.selectedBlocks.add(uid)
    updateBlockVisualSelection(uid, true)
  }
  
  // Expose functions globally for Block.js
  window.selectBlock = selectBlock
  window.deselectBlock = deselectBlock
  window.clearSelection = clearSelection
  window.Store = Store

  function deselectBlock(uid) {
    Store.selectedBlocks.delete(uid)
    updateBlockVisualSelection(uid, false)
  }

  function clearSelection() {
    for (const uid of Store.selectedBlocks) {
      updateBlockVisualSelection(uid, false)
    }
    Store.selectedBlocks.clear()
  }

  function updateBlockVisualSelection(uid, selected) {
    const blockInfo = Store.blocks.get(uid)
    if (blockInfo && blockInfo.el) {
      if (selected) {
        blockInfo.el.classList.add('selected')
      } else {
        blockInfo.el.classList.remove('selected')
      }
    }
  }

  function isBlockInSelectionBox(blockEl, box) {
    const rect = blockEl.getBoundingClientRect()
    const canvas = document.getElementById('canvas')
    const canvasRect = canvas.getBoundingClientRect()
    const canvasContent = document.getElementById('canvas-content')
    const transform = getTransform(canvasContent)
    
    // Convert block position to canvas coordinates
    const blockLeft = (rect.left - canvasRect.left - transform.x) / transform.scale
    const blockTop = (rect.top - canvasRect.top - transform.y) / transform.scale
    const blockRight = blockLeft + rect.width / transform.scale
    const blockBottom = blockTop + rect.height / transform.scale
    
    // Check if block overlaps with selection box
    return !(blockRight < Math.min(box.startX, box.endX) || 
             blockLeft > Math.max(box.startX, box.endX) || 
             blockBottom < Math.min(box.startY, box.endY) || 
             blockTop > Math.max(box.startY, box.endY))
  }

  function updateSelectionBox(box) {
    let selectionBoxEl = document.getElementById('selection-box')
    if (!selectionBoxEl) {
      selectionBoxEl = document.createElement('div')
      selectionBoxEl.id = 'selection-box'
      selectionBoxEl.className = 'selection-box'
      document.getElementById('canvas-content').appendChild(selectionBoxEl)
    }
    
    if (box) {
      const left = Math.min(box.startX, box.endX)
      const top = Math.min(box.startY, box.endY)
      const width = Math.abs(box.endX - box.startX)
      const height = Math.abs(box.endY - box.startY)
      
      selectionBoxEl.style.left = left + 'px'
      selectionBoxEl.style.top = top + 'px'
      selectionBoxEl.style.width = width + 'px'
      selectionBoxEl.style.height = height + 'px'
      selectionBoxEl.style.display = 'block'
    } else {
      selectionBoxEl.style.display = 'none'
    }
  }

  // Canvas connection renderer
  function ensureSvgLayer(canvas) {
    let svg = canvas.querySelector('svg.conn-layer')
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.classList.add('conn-layer')
      svg.setAttribute('width', '100%')
      svg.setAttribute('height', '100%')
      svg.style.position = 'absolute'
      svg.style.inset = '0'
      svg.style.pointerEvents = 'none'
      canvas.appendChild(svg)
    }
    return svg
  }

  function computeAnchor(el) {
    // Compute in canvas viewport coordinates (SVG overlay space)
    const canvas = document.getElementById('canvas')
    const target = el.querySelector && el.querySelector('.port-dot') ? el.querySelector('.port-dot') : el
    const tr = target.getBoundingClientRect()
    const cr = canvas.getBoundingClientRect()
    const x = tr.left - cr.left + tr.width / 2
    const y = tr.top - cr.top + tr.height / 2
    return { x, y }
  }

  function drawConnections(canvas) {
    const svg = ensureSvgLayer(canvas)
    svg.innerHTML = ''

    // Exec connections (one per fromBlock)
    Store.exec.forEach((val, fromKey) => {
      const [fromUid, outKey] = fromKey.split(':exec:')
      const fromBlock = Store.blocks.get(fromUid)
      const toBlock = val ? Store.blocks.get(val.toUid) : null
      if (!fromBlock || !toBlock) return
      const selector = outKey ? `.exec.out[data-exec-key="${outKey}"]` : '.exec.out'
      const fromPort = fromBlock.el.querySelector(selector)
      let toPort = null
      if (val && val.toExecKey != null) {
        toPort = toBlock.el.querySelector(`.exec.in[data-exec-key="${val.toExecKey}"]`)
      }
      if (!toPort && val && val.toExecIndex != null) {
        toPort = toBlock.el.querySelector(`.exec.in[data-exec-index="${val.toExecIndex}"]`)
      }
      if (!toPort) toPort = toBlock.el.querySelector('.exec.in')
      if (!fromPort || !toPort) return
      const a = computeAnchor(fromPort)
      const b = computeAnchor(toPort)
      svg.appendChild(createPath(a, b, 'exec'))
    })

    // Var connections
    Store.vars.forEach((toSet, key) => {
      const [fromUid, , outIndexStr] = key.split(':')
      const fromBlock = Store.blocks.get(fromUid)
      if (!fromBlock) return
      const fromPort = fromBlock.el.querySelector(`.port-out[data-index="${outIndexStr}"]`) || fromBlock.el.querySelector(`.port.port-out[data-index="${outIndexStr}"]`)
      for (const { toUid, inIndex } of toSet) {
        const toBlock = Store.blocks.get(toUid)
        if (!toBlock) continue
        const toPort = toBlock.el.querySelector(`.port-in[data-index="${inIndex}"]`) || toBlock.el.querySelector(`.port.port-in[data-index="${inIndex}"]`)
        if (!fromPort || !toPort) continue
        const a = computeAnchor(fromPort)
        const b = computeAnchor(toPort)
        svg.appendChild(createPath(a, b, 'var'))
      }
    })
  }

  function createPath(a, b, kind) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    // Horizontal left-to-right curve
    const dx = Math.max(0, b.x - a.x)
    const cx = Math.max(40, dx * 0.6)
    const c1 = `${a.x + cx},${a.y}`
    const c2 = `${b.x - cx},${b.y}`
    const d = `M ${a.x},${a.y} C ${c1} ${c2} ${b.x},${b.y}`
    path.setAttribute('d', d)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', kind === 'exec' ? '#f28fad' : '#7aa2f7')
    path.setAttribute('stroke-width', '2')
    path.setAttribute('stroke-linecap', 'round')
    return path
  }

  // Connection interaction state
  const ConnectState = {
    active: null // { kind: 'exec'|'var', fromBlockId, fromDir, outIndex?, el }
  }

  function beginConnectionFrom(el) {
    const block = el.closest('.block')
    const blockUid = block && block.dataset.blockUid
    if (!blockUid) return
    const portKind = el.dataset.port
    const direction = el.dataset.direction
    if (portKind === 'exec' && direction !== 'out') return
    if (portKind === 'var' && direction !== 'out') return
    ConnectState.active = {
      kind: portKind,
      fromUid: blockUid,
      fromDir: direction,
      outIndex: portKind === 'var' ? Number(el.dataset.index) : undefined,
      execKey: portKind === 'exec' ? (el.dataset.execKey || undefined) : undefined,
      el
    }
    el.classList.add('connecting')
  }

  function completeConnectionTo(el) {
    if (!ConnectState.active) return false
    const block = el.closest('.block')
    const blockUid = block && block.dataset.blockUid
    const portKind = el.dataset.port
    const direction = el.dataset.direction
    const isVar = portKind === 'var' && ConnectState.active.kind === 'var'
    const isExec = portKind === 'exec' && ConnectState.active.kind === 'exec'
    if (!blockUid || !(isVar || isExec) || direction !== 'in') return false

    if (isExec) {
      // One-to-one per output port; allow multiple distinct output ports
      const outKey = ConnectState.active.execKey != null ? String(ConnectState.active.execKey) : 'out'
      const outMapKey = `${ConnectState.active.fromUid}:exec:${outKey}`
      // Remove existing connection from this specific out port
      if (Store.exec.has(outMapKey)) Store.exec.delete(outMapKey)
      // Ensure uniqueness of incoming target per in port
      const inIndex = Number(el.dataset.execIndex || '0')
      for (const [k, v] of Array.from(Store.exec.entries())) {
        if (v && v.toUid === blockUid) {
          if ((v.toExecIndex != null && v.toExecIndex === inIndex) || (v.toExecKey != null && v.toExecKey === (el.dataset.execKey || undefined))) {
            Store.exec.delete(k)
          }
        }
      }
      if (ConnectState.active.fromUid !== blockUid) {
        Store.exec.set(outMapKey, { toUid: blockUid, toExecKey: el.dataset.execKey || undefined, toExecIndex: inIndex })
      }
    } else if (isVar) {
      const fromUid = ConnectState.active.fromUid
      const outIndex = ConnectState.active.outIndex || 0
      const key = `${fromUid}:out:${outIndex}`
      const inIndex = Number(el.dataset.index) || 0
      // allow multiple targets from the same output; but keep single incoming per target input
      if (!Store.vars.has(key)) Store.vars.set(key, new Set())
      const setRef = Store.vars.get(key)
      // remove any existing connection to this specific target input
      for (const item of setRef) { if (item.toUid === blockUid && item.inIndex === inIndex) setRef.delete(item) }
      if (fromUid !== blockUid) setRef.add({ toUid: blockUid, inIndex })
      // ensure single incoming per target input globally
      for (const [k, s] of Array.from(Store.vars.entries())) {
        if (k === key) continue
        for (const it of Array.from(s)) {
          if (it.toUid === blockUid && it.inIndex === inIndex) s.delete(it)
        }
        if (s.size === 0) Store.vars.delete(k)
      }
    }

    ConnectState.active.el.classList.remove('connecting')
    ConnectState.active = null
    return true
  }

  function cancelConnection() {
    if (ConnectState.active) {
      ConnectState.active.el.classList.remove('connecting')
      ConnectState.active = null
    }
  }

  // Bridge to Python-compatible Block data
  function compileToPythonBlocks() {
    const result = []
    Store.blocks.forEach(({ uid, id, data }) => {
      const py = {
        id: id,
        uid: uid,
        content: data.content || '',
        button_class: data.button_class || null,
        has_input_executor: Boolean(data.has_input_executor),
        has_output_executor: Boolean(data.has_output_executor),
        exec_input_nodes: Array.isArray(data.exec_input_nodes) ? data.exec_input_nodes : [],
        exec_output_nodes: Array.isArray(data.exec_output_nodes) ? data.exec_output_nodes : [],
        variables_input_nodes: Array.isArray(data.variables_input_nodes) ? data.variables_input_nodes : [],
        variables_input_nodes_types: Array.isArray(data.variables_input_nodes_types) ? data.variables_input_nodes_types : [],
        variables_output_nodes: Array.isArray(data.variables_output_nodes) ? data.variables_output_nodes : [],
        variables_output_nodes_types: Array.isArray(data.variables_output_nodes_types) ? data.variables_output_nodes_types : [],
        in_connection_id: null,
        out_connection_id: null,
        exec_out_refs: {},
        exec_in_refs: {},
        variables_input_references: [],
        variables_output_references: [],
        function_name: data.function_name || null,
        extra_context_string: data.extra_context_string || null,
        inline_values: data.inline_values || {}
      }

      // Exec linked list references
      // Exec refs map by output key -> toUid
      for (const [k, v] of Store.exec.entries()) {
        const [fromUid, outKey] = k.split(':exec:')
        if (fromUid === uid && v) py.exec_out_refs[outKey] = v.toUid
        if (v && v.toUid === uid) {
          py.exec_in_refs[outKey] = fromUid
        }
      }

      // Variable references: for each input index, find any incoming (exactly one or null)
      const inputCount = py.variables_input_nodes.length
      for (let i = 0; i < inputCount; i++) {
        let ref = null
        for (const [k, setRef] of Store.vars.entries()) {
          for (const v of setRef) {
            if (v.toUid === uid && v.inIndex === i) {
              const [fromUid] = k.split(':out:')
              const src = Store.blocks.get(fromUid)
              if (src && (src.data.button_class || '').toLowerCase() === 'variable') {
                ref = src.data.variable_uid || src.uid
              } else {
                ref = k
              }
              break
            }
          }
          if (ref) break
        }
        py.variables_input_references.push(ref)
      }
      // For outputs, mark where they are connected to (standardized: per-output array of refs or null; fan-out allowed)
      const outputCount = py.variables_output_nodes.length
      for (let o = 0; o < outputCount; o++) {
        const key = `${uid}:out:${o}`
        const setRef = Store.vars.get(key)
        if (!setRef || setRef.size === 0) { py.variables_output_references.push(null); continue }
        const outTargets = []
        for (const v of setRef) {
          const target = Store.blocks.get(v.toUid)
          if (target && (target.data.button_class || '').toLowerCase() === 'variable') {
            outTargets.push(target.data.variable_uid || target.uid)
          } else {
            outTargets.push(`${v.toUid}:in:${v.inIndex}`)
          }
        }
        py.variables_output_references.push(outTargets)
      }

      // Inject default variable value metadata if this is a Variable block
      if ((data.button_class || '').toLowerCase() === 'variable') {
        const vinfo = data.variable_uid && Store.variables.get(data.variable_uid)
        if (vinfo) {
          py.variable = {
            name: vinfo.name,
            type: vinfo.type,
            value: vinfo.value,
            is_global: !!vinfo.is_global,
            global_id: vinfo.global_id || null,
            local_id: vinfo.local_id || null,
            uid: vinfo.uid
          }
        }
      }

      result.push(py)
    })
    // Only include blocks reachable from BeginPlay (exec graph) and variables feeding into reachable blocks
    const reachable = new Set()
    // find begin play block(s)
    const begins = Array.from(Store.blocks.values()).filter(b => (b.data.button_class || '').toLowerCase() === 'executor' && ((b.data.id || '').toLowerCase().includes('begin') || (b.data.content || '').toLowerCase().includes('begin')))
    const queue = begins.map(b => b.uid)
    while (queue.length) {
      const cur = queue.shift()
      if (reachable.has(cur)) continue
      reachable.add(cur)
      // enqueue exec neighbors for all out ports of cur
      for (const [k, v] of Store.exec.entries()) {
        const [fromUid] = k.split(':exec:')
        if (fromUid === cur && v && !reachable.has(v.toUid)) {
          queue.push(v.toUid)
        }
      }
    }
    // include any variable blocks that feed data into reachable blocks
    const include = new Set(reachable)
    for (const b of result) {
      if (include.has(b.uid)) continue
      // if this block has outputs connected to an included block, include it
      for (const [key, setRef] of Store.vars.entries()) {
        const [fromUid] = key.split(':out:')
        if (fromUid !== b.uid) continue
        for (const v of setRef) {
          if (include.has(v.toUid)) { include.add(b.uid); break }
        }
        if (include.has(b.uid)) break
      }
    }
    return result.filter(b => include.has(b.uid))
  }

  window.CompileBridge = { toPython: compileToPythonBlocks }
  function addVarRow(listEl) {
    const row = document.createElement('div')
    row.className = 'var-row'
    row.innerHTML = `
      <input class="var-name" type="text" placeholder="name">
      <input class="var-type" type="text" placeholder="type">
      <button type="button" class="remove">×</button>
    `
    row.querySelector('.remove').addEventListener('click', () => row.remove())
    listEl.appendChild(row)
  }

  function collectVars(listEl) {
    const names = []
    const types = []
    qsa('.var-row', listEl).forEach((row) => {
      names.push(qs('.var-name', row).value.trim())
      types.push(qs('.var-type', row).value.trim())
    })
    return { names, types }
  }

  function onReady() {
    const canvas = qs('#canvas')
    const content = qs('#canvas-content')
    const builtinList = qs('#builtin-list')
    const discoveredList = qs('#discovered-list')
    const compileBtn = qs('#compile-btn')
    const compileOut = qs('#compile-output')
    const debugPython = qs('#debug-python')
    const varsList = qs('#variables-list')
    const addVarBtn = qs('#add-var')
    const saveBtn = qs('#save-project')
    const loadBtn = qs('#load-project')
    const inspector = qs('#inspector')
    const inspectorContent = qs('#inspector-content')

    // hide manual creation UI; use library buttons instead

    if (window.blocksApi && typeof window.blocksApi.list === 'function') {
      window.blocksApi.list().then((blocks) => {
        (blocks || []).forEach((b, idx) => {
          const view = new window.BlockView(b)
          view.el.style.left = 40 + (idx * 40) + 'px'
          view.el.style.top = 40 + (idx * 30) + 'px'
          content.appendChild(view.el)
          addBlockToStore(view.data.uid, view.el, view.data)
          wireBlockEvents(view.el, canvas)
        })
      })
      if (typeof window.blocksApi.onCreated === 'function') {
        window.blocksApi.onCreated((b) => {
          // Could add toast/notification here
          console.log('Block created via IPC', b)
        })
      }
    }

    // Pan/Zoom state
    const View = { scale: 1, x: 0, y: 0 }
    function applyView() {
      content.style.transform = `translate(${View.x}px, ${View.y}px) scale(${View.scale})`
      const svg = canvas.querySelector('svg.conn-layer')
      if (svg) {
        // keep svg static sized, but redraw to match current positions
        drawConnections(canvas)
      }
    }
    function clampScale(s) { return Math.min(2.5, Math.max(0.3, s)) }
    canvas.addEventListener('wheel', (e) => {
      // Always treat wheel as zoom for simplicity
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const old = View.scale
      const delta = e.deltaY < 0 ? 1.1 : 0.9
      View.scale = clampScale(View.scale * delta)
      // Zoom around mouse
      View.x = mx - (mx - View.x) * (View.scale / old)
      View.y = my - (my - View.y) * (View.scale / old)
      applyView()
    }, { passive: false })
    // Middle mouse or space+drag to pan
    let panning = false, sx=0, sy=0, ox=0, oy=0
    function startPan(e) { panning = true; sx = e.clientX; sy = e.clientY; ox = View.x; oy = View.y }
    function movePan(e) { if (!panning) return; View.x = ox + (e.clientX - sx); View.y = oy + (e.clientY - sy); applyView() }
    function endPan() { panning = false }
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault() })
    canvas.addEventListener('mousedown', (e) => {
      // Start panning with middle or right button anywhere, or left button when clicking background
      const isBackground = e.target === canvas || e.target === content
      if (e.button === 1 || e.buttons === 4 || e.button === 2 || (isBackground && e.button === 0) || (canvas.classList.contains('panning') && e.button === 0)) {
        e.preventDefault()
        startPan(e)
      }
    })
    window.addEventListener('mousemove', movePan)
    window.addEventListener('mouseup', endPan)
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') canvas.classList.add('panning') })
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') canvas.classList.remove('panning') })
    canvas.addEventListener('mousedown', (e) => { if (canvas.classList.contains('panning') && e.button === 0) startPan(e) })

    // Ensure all blocks are appended to content, not canvas root
    function appendToContent(el) { content.appendChild(el) }

    // Palette population
    addBuiltinBlocks(builtinList, canvas, content)
    ensureBeginPlay(canvas, content)

    // Discovered modules
    if (window.blocksApi && typeof window.blocksApi.listFunctions === 'function') {
      window.blocksApi.listFunctions().then((fns) => {
        (fns || []).slice(0, 100).forEach((fn) => {
          const inputs = (fn.inputs || []).filter(p => !['vararg','varkw'].includes(p.kind)).map(p => p.name)
          const inputTypes = (fn.inputs || []).filter(p => !['vararg','varkw'].includes(p.kind)).map(p => p.annotation || 'any')
          const outName = 'result'
          const outType = fn.output || 'any'
          
          // Add to available blocks for search
          const template = {
            id: `${fn.module_name}.${fn.name}`,
            button_class: 'Function',
            content: fn.docstring || 'Function block',
            has_input_executor: true,
            has_output_executor: true,
            variables_input_nodes: inputs,
            variables_input_nodes_types: inputTypes,
            variables_output_nodes: [outName],
            variables_output_nodes_types: [outType],
            function_name: `${fn.module_name}.${fn.name}`
          }
          
          Store.availableBlocks.set(`${fn.module_name}.${fn.name}`, {
            id: `${fn.module_name}.${fn.name}`,
            name: `${fn.module_name}.${fn.name}`,
            type: 'function',
            description: fn.docstring || 'Function block',
            template: template
          })
          
          const el = document.createElement('button')
          el.type = 'button'
          el.className = 'pal-item function'
          el.textContent = `${fn.module_name}.${fn.name}`
          el.title = (fn.docstring || '')
          el.addEventListener('click', () => {
            const view = window.BlockFactory.createFromTemplate('Function', template)
            view.el.style.left = Math.round(Math.random() * 400 + 40) + 'px'
            view.el.style.top = Math.round(Math.random() * 300 + 40) + 'px'
            content.appendChild(view.el)
            addBlockToStore(view.data.uid, view.el, view.data)
            wireBlockEvents(view.el, canvas)
          })

          // Add drag and drop functionality
          el.draggable = true
          el.addEventListener('dragstart', (ev) => {
            try { 
              ev.dataTransfer.setData('application/x-block-template', JSON.stringify(template)) 
            } catch (_) {}
          })

          discoveredList.appendChild(el)
        })
      })
    }

    // Global canvas wire
    wireCanvas(canvas)

    // Compile action
    compileBtn.addEventListener('click', async () => {
      console.log('[UI] Compile clicked')
      const out = window.CompileBridge.toPython()
      compileOut.textContent = JSON.stringify(out, null, 2)
      if (window.blocksApi && window.blocksApi.backend && typeof window.blocksApi.backend.generateCode === 'function') {
        let res
        try {
          res = await window.blocksApi.backend.generateCode({ blocks: out, debug: !!debugPython.checked })
        } catch (e) {
          console.error('[UI] backend.generateCode failed', e)
          compileOut.textContent += '\n\nbackend.generateCode error: ' + (e && e.message || e)
          return
        }
        const lines = []
        lines.push(`exit: ${res.code}`)
        if (res.stdout) lines.push(`stdout:\n${res.stdout}`)
        if (res.stderr) lines.push(`stderr:\n${res.stderr}`)
        console.log('backend.generateCode ->', res)
        // append to compile output panel for visibility
        compileOut.textContent = JSON.stringify(out, null, 2) + '\n\n' + lines.join('\n')
      }
    })

    // Variables panel

    function updateAvailableVariableBlocks() {
      // Update available blocks with current variables
      Variables.list.forEach((variable) => {
        // Add GetVariable block
        const getKey = `GetVariable_${variable.uid}`
        Store.availableBlocks.set(getKey, {
          id: getKey,
          name: `Get ${variable.name}`,
          type: 'variable',
          description: `Get the value of variable '${variable.name}' (${variable.type})`,
          template: {
            id: 'Variable',
            button_class: 'Variable',
            content: `Variable ${variable.name}`,
            variable_uid: variable.uid,
            has_input_executor: false,
            has_output_executor: false,
            exec_input_nodes: [],
            exec_output_nodes: [],
            variables_input_nodes: [],
            variables_input_nodes_types: [],
            variables_output_nodes: ['value'],
            variables_output_nodes_types: [variable.type || 'any'],
            variable: variable,
            function_name: null
          }
        })

        // Add SetVariable block
        const setKey = `SetVariable_${variable.uid}`
        Store.availableBlocks.set(setKey, {
          id: setKey,
          name: `Set ${variable.name}`,
          type: 'variable',
          description: `Set the value of variable '${variable.name}' (${variable.type})`,
          template: {
            id: 'SetVariable',
            button_class: 'Variable',
            content: `Set ${variable.name}`,
            variable_uid: variable.uid,
            has_input_executor: true,
            has_output_executor: true,
            exec_input_nodes: ['in'],
            exec_output_nodes: ['out'],
            variables_input_nodes: ['value'],
            variables_input_nodes_types: [variable.type || 'any'],
            variables_output_nodes: [],
            variables_output_nodes_types: [],
            variable: variable,
            function_name: null
          }
        })
      })
    }

    function renderVariables() {
      updateAvailableVariableBlocks() // Update available blocks first
      varsList.innerHTML = ''
      Variables.list.forEach((v) => {
        const item = document.createElement('div')
        item.className = 'var-item'
        item.dataset.uid = v.uid
        
        const varInfo = document.createElement('div')
        varInfo.className = 'var-info'
        
        const name = document.createElement('div')
        name.className = 'name'
        name.textContent = v.name
        
        const metaRow = document.createElement('div')
        metaRow.style.display = 'flex'
        metaRow.style.alignItems = 'center'
        metaRow.style.gap = '8px'
        
        const type = document.createElement('span')
        type.className = 'type'
        type.textContent = v.type || 'any'
        
        metaRow.appendChild(type)
        
        if (v.value !== undefined && v.value !== '') {
          const value = document.createElement('span')
          value.className = 'value'
          value.textContent = String(v.value).slice(0, 20) + (String(v.value).length > 20 ? '...' : '')
          metaRow.appendChild(value)
        }
        
        varInfo.appendChild(name)
        varInfo.appendChild(metaRow)
        
        const actions = document.createElement('div')
        actions.style.display = 'flex'
        actions.style.alignItems = 'center'
        actions.style.gap = '8px'
        
        const deleteBtn = document.createElement('button')
        deleteBtn.className = 'var-delete-btn'
        deleteBtn.textContent = '×'
        deleteBtn.title = 'Delete variable'
        deleteBtn.style.cssText = 'width:20px;height:20px;border-radius:4px;border:1px solid var(--border);background:rgba(242,143,173,0.1);color:var(--red);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;'
        
        const dragHandle = document.createElement('div')
        dragHandle.className = 'drag-handle'
        dragHandle.textContent = '⋮⋮'
        dragHandle.title = 'Drag to canvas'
        
        actions.appendChild(deleteBtn)
        actions.appendChild(dragHandle)
        
        item.appendChild(varInfo)
        item.appendChild(actions)
        
        // Delete button functionality
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          deleteVariable(v)
        })
        
        // Click to select/edit
        item.addEventListener('click', (e) => {
          if (e.target === dragHandle || e.target === deleteBtn) return
          // Remove previous selection
          qsa('.var-item.selected').forEach(el => el.classList.remove('selected'))
          item.classList.add('selected')
          showInspectorForVar(v)
        })
        
        // Drag to canvas functionality
        let isDragging = false
        dragHandle.addEventListener('pointerdown', (e) => {
          e.stopPropagation()
          isDragging = true
          dragHandle.style.cursor = 'grabbing'
          
          const onMove = (moveE) => {
            if (!isDragging) return
            // Visual feedback could be added here
          }
          
          const onUp = (upE) => {
            if (!isDragging) return
            isDragging = false
            dragHandle.style.cursor = 'grab'
            document.removeEventListener('pointermove', onMove)
            document.removeEventListener('pointerup', onUp)
            
            // Check if dropped on canvas
            const canvas = qs('#canvas')
            const canvasRect = canvas.getBoundingClientRect()
            if (upE.clientX >= canvasRect.left && upE.clientX <= canvasRect.right &&
                upE.clientY >= canvasRect.top && upE.clientY <= canvasRect.bottom) {
              createVariableBlockFromDrag(v, upE.clientX, upE.clientY)
            }
          }
          
          document.addEventListener('pointermove', onMove)
          document.addEventListener('pointerup', onUp)
        })
        
        // Keep legacy drag support
        item.draggable = true
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/x-var', JSON.stringify(v))
        })
        
        varsList.appendChild(item)
      })
    }

    function deleteVariable(variable) {
      // Find all blocks that reference this variable
      const relatedBlocks = []
      for (const [uid, blockData] of Store.blocks.entries()) {
        const block = blockData.data
        // Check if this is a Variable block for this variable
        if (block.button_class === 'Variable' && block.variable_uid === variable.uid) {
          relatedBlocks.push({ uid, name: block.id || 'Variable Block', type: 'Variable Block' })
          continue
        }
        
        // Check variable input references
        if (block.variables_input_references) {
          for (let i = 0; i < block.variables_input_references.length; i++) {
            const ref = block.variables_input_references[i]
            if (ref === variable.uid) {
              relatedBlocks.push({ uid, name: block.id || 'Block', type: 'Input Connection' })
              break
            }
          }
        }
        
        // Check variable connections in Store.vars
        for (const [key, targets] of Store.vars.entries()) {
          const [fromUid] = key.split(':out:')
          if (fromUid === uid) {
            for (const target of targets) {
              const targetBlock = Store.blocks.get(target.toUid)
              if (targetBlock && targetBlock.data.variables_input_references) {
                const ref = targetBlock.data.variables_input_references[target.inIndex]
                if (ref === variable.uid) {
                  relatedBlocks.push({ uid: target.toUid, name: targetBlock.data.id || 'Block', type: 'Variable Connection' })
                }
              }
            }
          }
        }
      }
      
      // Show confirmation dialog
      let message = `Delete variable "${variable.name}"?`
      if (relatedBlocks.length > 0) {
        message += `\n\nThis will also delete ${relatedBlocks.length} related block(s):\n`
        relatedBlocks.forEach(block => {
          message += `• ${block.name} (${block.type})\n`
        })
      }
      
      if (!confirm(message)) return
      
      // Remove related blocks
      relatedBlocks.forEach(block => {
        const blockData = Store.blocks.get(block.uid)
        if (blockData && blockData.el) {
          // Trigger delete event
          const deleteEvent = new CustomEvent('block:delete', { 
            bubbles: true, 
            detail: { uid: block.uid } 
          })
          blockData.el.dispatchEvent(deleteEvent)
        }
      })
      
      // Remove variable from Variables.list
      const index = Variables.list.findIndex(v => v.uid === variable.uid)
      if (index >= 0) {
        Variables.list.splice(index, 1)
      }

      // Remove variable blocks from available blocks
      Store.availableBlocks.delete(`GetVariable_${variable.uid}`)
      Store.availableBlocks.delete(`SetVariable_${variable.uid}`)
      
      // Remove from Store.variables if it exists there
      Store.variables.delete(variable.uid)
      
      // Clear inspector if this variable was selected
      const selectedItem = qs('.var-item.selected')
      if (selectedItem && selectedItem.dataset.uid === variable.uid) {
        const inspectorContent = qs('#inspector-content')
        if (inspectorContent) {
          inspectorContent.innerHTML = 'Select a variable to edit'
        }
      }
      
      // Refresh the variables list
      renderVariables()
      
      // Redraw connections
      const canvas = qs('#canvas')
      if (canvas) drawConnections(canvas)
    }

    function showInspectorForVar(v) {
      inspectorContent.innerHTML = ''
      const nameLbl = document.createElement('label')
      nameLbl.textContent = 'Name'
      const nameInput = document.createElement('input')
      nameInput.value = v.name
      nameInput.addEventListener('input', () => { v.name = nameInput.value; renderVariables(); })
      const typeLbl = document.createElement('label')
      typeLbl.textContent = 'Type'
      const typeInput = document.createElement('input')
      typeInput.value = v.type || ''
      typeInput.addEventListener('input', () => { v.type = typeInput.value; renderVariables(); })
      const valueLbl = document.createElement('label')
      valueLbl.textContent = 'Value'
      const valueInput = document.createElement('input')
      valueInput.value = v.value == null ? '' : String(v.value)
      valueInput.addEventListener('input', () => { v.value = valueInput.value })
      inspectorContent.appendChild(nameLbl)
      inspectorContent.appendChild(nameInput)
      inspectorContent.appendChild(typeLbl)
      inspectorContent.appendChild(typeInput)
      inspectorContent.appendChild(valueLbl)
      inspectorContent.appendChild(valueInput)
      // Sync to Store.variables
      Store.variables.set(v.uid, v)
    }

    addVarBtn.addEventListener('click', () => {
      const uid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('var-' + Math.random().toString(36).slice(2))
      Variables.list.push({ name: 'var' + (Variables.list.length + 1), type: 'any', value: '', uid, is_global: false, global_id: null, local_id: null })
      Store.variables.set(uid, Variables.list[Variables.list.length - 1])
      renderVariables()
    })

    // Save/Load project
    function serializeProject() {
      // We want raw graph, not filtered by BeginPlay; reconstruct from Store
      const all = []
      Store.blocks.forEach(({ uid, data, el }) => {
        // Re-run exporter piece per block to get full JSON schema
        const py = {
          id: data.id,
          uid: uid,
          content: data.content || '',
          button_class: data.button_class || null,
          has_input_executor: Boolean(data.has_input_executor),
          has_output_executor: Boolean(data.has_output_executor),
          exec_input_nodes: Array.isArray(data.exec_input_nodes) ? data.exec_input_nodes : [],
          exec_output_nodes: Array.isArray(data.exec_output_nodes) ? data.exec_output_nodes : [],
          variables_input_nodes: Array.isArray(data.variables_input_nodes) ? data.variables_input_nodes : [],
          variables_input_nodes_types: Array.isArray(data.variables_input_nodes_types) ? data.variables_input_nodes_types : [],
          variables_output_nodes: Array.isArray(data.variables_output_nodes) ? data.variables_output_nodes : [],
          variables_output_nodes_types: Array.isArray(data.variables_output_nodes_types) ? data.variables_output_nodes_types : [],
          in_connection_id: null,
          out_connection_id: null,
          exec_out_refs: {},
          exec_in_refs: {},
          variables_input_references: [],
          variables_output_references: [],
          function_name: data.function_name || null,
          extra_context_string: data.extra_context_string || null,
          inline_values: data.inline_values || {},
          position: undefined
        }
        // position
        const leftPx = parseFloat(el.style.left || '0') || 0
        const topPx = parseFloat(el.style.top || '0') || 0
        py.position = { x: Math.round(leftPx), y: Math.round(topPx) }
        for (const [k, v] of Store.exec.entries()) {
          const [fromUid, outKey] = k.split(':exec:')
          if (fromUid === uid && v) py.exec_out_refs[outKey] = v.toUid
          if (v && v.toUid === uid) py.exec_in_refs[outKey] = fromUid
        }
        const inputCount = py.variables_input_nodes.length
        for (let i = 0; i < inputCount; i++) {
          let ref = null
          for (const [k, setRef] of Store.vars.entries()) {
            for (const v of setRef) {
              if (v.toUid === uid && v.inIndex === i) {
                const [fromUid] = k.split(':out:')
                const src = Store.blocks.get(fromUid)
                if (src && (src.data.button_class || '').toLowerCase() === 'variable') {
                  ref = src.data.variable_uid || src.uid
                } else {
                  ref = k
                }
                break
              }
            }
            if (ref) break
          }
          py.variables_input_references.push(ref)
        }
        const outputCount = py.variables_output_nodes.length
        for (let o = 0; o < outputCount; o++) {
          const key = `${uid}:out:${o}`
          const setRef = Store.vars.get(key)
          if (!setRef || setRef.size === 0) { py.variables_output_references.push(null); continue }
          const outTargets = []
          for (const v of setRef) {
            const target = Store.blocks.get(v.toUid)
            if (target && (target.data.button_class || '').toLowerCase() === 'variable') {
              outTargets.push(target.data.variable_uid || target.uid)
            } else {
              outTargets.push(`${v.toUid}:in:${v.inIndex}`)
            }
          }
          py.variables_output_references.push(outTargets)
        }
        if ((data.button_class || '').toLowerCase() === 'variable') {
          const vinfo = data.variable_uid && Store.variables.get(data.variable_uid)
          if (vinfo) {
            py.variable = { ...vinfo }
            py.variable_uid = vinfo.uid
          } else {
            py.variable_uid = data.variable_uid || null
          }
        }
        all.push(py)
      })
      return { blocks: all, variables: Array.from(Store.variables.values()) }
    }

    saveBtn.addEventListener('click', async () => {
      if (!(window.blocksApi && window.blocksApi.backend && window.blocksApi.backend.saveProject)) return
      const proj = serializeProject()
      const res = await window.blocksApi.backend.saveProject(proj)
      if (!res || !res.ok) console.error('Save failed', res)
    })

    // Context menu search
    const blockSearch = qs('#block-search')
    if (blockSearch) {
      blockSearch.addEventListener('input', (e) => {
        updateContextMenuResults(e.target.value)
      })
      
      blockSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          hideContextMenu()
        } else if (e.key === 'Enter') {
          const firstResult = qs('.context-result-item')
          if (firstResult) {
            firstResult.click()
          }
        }
      })
    }

    loadBtn.addEventListener('click', async () => {
      if (!(window.blocksApi && window.blocksApi.backend && window.blocksApi.backend.loadProject)) return
      const res = await window.blocksApi.backend.loadProject()
      if (!res || !res.ok || !res.data) return
      // Clear current canvas
      const blocksToRemove = Array.from(Store.blocks.keys())
      blocksToRemove.forEach((uid) => removeConnectionsForBlock(uid))
      Store.blocks.clear()
      const contentChildren = Array.from(content.children)
      contentChildren.forEach((el) => { if (el.classList && el.classList.contains('block')) el.remove() })
      // Restore variables map and list UI
      Store.variables.clear()
      Variables.list = Array.isArray(res.data.variables) ? res.data.variables.slice() : []
      Variables.list.forEach((v) => { if (v && v.uid) Store.variables.set(v.uid, v) })
      renderVariables() // This will also call updateAvailableVariableBlocks()
      // Recreate blocks
      const byUid = new Map()
      ;(res.data.blocks || []).forEach((b) => {
        const view = new window.BlockView(b)
        // apply saved position
        if (b.position && typeof b.position.x === 'number' && typeof b.position.y === 'number') {
          view.el.style.left = b.position.x + 'px'
          view.el.style.top = b.position.y + 'px'
        }
        content.appendChild(view.el)
        addBlockToStore(view.data.uid, view.el, view.data)
        wireBlockEvents(view.el, canvas)
        byUid.set(b.uid, view)
      })
      // Recreate connections
      ;(res.data.blocks || []).forEach((b) => {
        const uid = b.uid
        const execOut = b.exec_out_refs || {}
        Object.keys(execOut).forEach((k) => {
          Store.exec.set(`${uid}:exec:${k}`, { toUid: execOut[k] })
        })
        const outCount = (b.variables_output_nodes || []).length
        for (let o = 0; o < outCount; o++) {
          const refs = (b.variables_output_references || [])[o]
          if (!refs) continue
          const key = `${uid}:out:${o}`
          if (!Store.vars.has(key)) Store.vars.set(key, new Set())
          const setRef = Store.vars.get(key)
          ;(Array.isArray(refs) ? refs : [refs]).forEach((r) => {
            if (typeof r !== 'string') return
            if (r.includes(':in:')) {
              const [toUid, , inIndexStr] = r.split(':')
              setRef.add({ toUid, inIndex: Number(inIndexStr) || 0 })
            } else {
              // variable UID target (rare), ignore in reconstruction of edges
            }
          })
        }
      })
      drawConnections(canvas)
    })

     // Allow dropping variables and block templates onto canvas
     canvas.addEventListener('dragover', (e) => {
       const types = Array.from(e.dataTransfer.types || [])
       if (types.includes('application/x-var') || types.includes('application/x-block-template')) {
         e.preventDefault()
       }
     })
     canvas.addEventListener('drop', (e) => {
       const varData = e.dataTransfer.getData('application/x-var')
       const tplData = e.dataTransfer.getData('application/x-block-template')
       if (!varData && !tplData) return
       e.preventDefault()
       
       const rect = canvas.getBoundingClientRect()
       // invert current transform to compute content coords
      const transform = getComputedStyle(content).transform
      let scale = 1, tx = 0, ty = 0
      if (transform && transform !== 'none') {
        const m = transform.match(/matrix\(([^)]+)\)/)
        if (m) { const parts = m[1].split(',').map(parseFloat); scale = parts[0]||1; tx = parts[4]||0; ty = parts[5]||0 }
      }
      const cx = (e.clientX - rect.left - tx) / scale
      const cy = (e.clientY - rect.top - ty) / scale

      if (tplData) {
        // Handle block template drop
        const template = JSON.parse(tplData)
        const view = window.BlockFactory.createFromTemplate(template.button_class, template)
        view.el.style.left = (cx - 40) + 'px'
        view.el.style.top = (cy - 20) + 'px'
        content.appendChild(view.el)
        addBlockToStore(view.data.uid, view.el, view.data)
        wireBlockEvents(view.el, canvas)
      } else if (varData) {
        // Handle variable drop
        const v = JSON.parse(varData)
        const view = window.BlockFactory.createFromTemplate('Variable', {
          id: 'Variable',
          button_class: 'Variable',
          content: `Variable ${v.name}`,
          variable_uid: v.uid,
          variables_output_nodes: ['value'],
          variables_output_nodes_types: [v.type || 'any']
        })
        view.el.style.left = (cx - 40) + 'px'
        view.el.style.top = (cy - 20) + 'px'
        content.appendChild(view.el)
        addBlockToStore(view.data.uid, view.el, view.data)
        wireBlockEvents(view.el, canvas)
      }
    })
  }

  function addBuiltinBlocks(container, canvas, content) {
    const builtins = [
      { name: 'Print', cls: 'Function', fn: 'builtins.print', inputs: ['value'], inputTypes: ['any'], out: null, outType: null, content: 'Print value' },
      { name: 'Add', cls: 'Function', fn: 'math_add', inputs: ['a','b'], inputTypes: ['number','number'], out: 'sum', outType: 'number', content: 'Add two numbers' },
      { name: 'Max', cls: 'Function', fn: 'math_max', inputs: ['a','b'], inputTypes: ['number','number'], out: 'max', outType: 'number', content: 'Max of two' },
      { name: 'If', cls: 'Conditional', fn: 'flow_if', inputs: ['condition'], inputTypes: ['bool'], out: null, outType: null, content: 'If condition' },
    ]

    const operators = [
      { name: 'Equal', cls: 'Operator', fn: 'operator.eq', inputs: ['a', 'b'], inputTypes: ['any', 'any'], out: 'result', outType: 'bool', content: 'Equal comparison' },
      { name: 'Greater', cls: 'Operator', fn: 'operator.gt', inputs: ['a', 'b'], inputTypes: ['any', 'any'], out: 'result', outType: 'bool', content: 'Greater than' },
      { name: 'Smaller', cls: 'Operator', fn: 'operator.lt', inputs: ['a', 'b'], inputTypes: ['any', 'any'], out: 'result', outType: 'bool', content: 'Less than' },
      { name: 'Not', cls: 'Operator', fn: 'operator.not_', inputs: ['value'], inputTypes: ['bool'], out: 'result', outType: 'bool', content: 'Logical NOT' },
      { name: 'Or', cls: 'Operator', fn: 'operator.or_', inputs: ['a', 'b'], inputTypes: ['bool', 'bool'], out: 'result', outType: 'bool', content: 'Logical OR' },
      { name: 'And', cls: 'Operator', fn: 'operator.and_', inputs: ['a', 'b'], inputTypes: ['bool', 'bool'], out: 'result', outType: 'bool', content: 'Logical AND' },
    ]
    
    // Process builtins
    builtins.forEach((b) => {
      // Add to available blocks for search
      const template = {
        id: b.fn || b.name,
        button_class: b.cls,
        content: b.content,
        has_input_executor: b.cls !== 'Variable',
        has_output_executor: b.cls !== 'Variable',
        variables_input_nodes: b.inputs,
        variables_input_nodes_types: b.inputTypes,
        variables_output_nodes: b.out ? [b.out] : (b.cls === 'Variable' ? ['value'] : []),
        variables_output_nodes_types: b.outType ? [b.outType] : (b.cls === 'Variable' ? ['any'] : []),
        function_name: b.fn
      }
      
      Store.availableBlocks.set(b.fn || b.name, {
        id: b.fn || b.name,
        name: b.name,
        type: b.cls.toLowerCase(),
        description: b.content,
        template: template
      })
      
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'pal-item ' + b.cls.toLowerCase()
      el.textContent = b.name
      el.addEventListener('click', () => {
        const view = window.BlockFactory.createFromTemplate(b.cls, template)
        view.el.style.left = Math.round(Math.random() * 400 + 40) + 'px'
        view.el.style.top = Math.round(Math.random() * 300 + 40) + 'px'
        content.appendChild(view.el)
        addBlockToStore(view.data.uid, view.el, view.data)
        wireBlockEvents(view.el, canvas)
      })

      // Add drag and drop functionality
      el.draggable = true
      el.addEventListener('dragstart', (ev) => {
        try { 
          ev.dataTransfer.setData('application/x-block-template', JSON.stringify(template)) 
        } catch (_) {}
      })

      container.appendChild(el)
    })

    // Process operators separately
    const operatorsContainer = qs('#operators-list')
    if (operatorsContainer) {
      operators.forEach((b) => {
        // Add to available blocks for search
        const template = {
          id: b.fn || b.name,
          button_class: b.cls,
          content: b.content,
          has_input_executor: false,
          has_output_executor: false,
          exec_input_nodes: [],
          exec_output_nodes: [],
          variables_input_nodes: b.inputs || [],
          variables_input_nodes_types: b.inputTypes || [],
          variables_output_nodes: b.out ? [b.out] : [],
          variables_output_nodes_types: b.outType ? [b.outType] : [],
          function_name: b.fn
        }
        
        Store.availableBlocks.set(b.fn || b.name, {
          id: b.fn || b.name,
          name: b.name,
          type: b.cls.toLowerCase(),
          description: b.content,
          template: template
        })
        
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'pal-item ' + b.cls.toLowerCase()
        el.textContent = b.name
        el.addEventListener('click', () => {
          const view = window.BlockFactory.createFromTemplate(b.cls, template)
          view.el.style.left = Math.round(Math.random() * 400 + 40) + 'px'
          view.el.style.top = Math.round(Math.random() * 300 + 40) + 'px'
          content.appendChild(view.el)
          addBlockToStore(view.data.uid, view.el, view.data)
          wireBlockEvents(view.el, canvas)
        })

        // Add drag and drop functionality
        el.draggable = true
        el.addEventListener('dragstart', (ev) => {
          try { 
            ev.dataTransfer.setData('application/x-block-template', JSON.stringify(template)) 
          } catch (_) {}
        })

        operatorsContainer.appendChild(el)
      })
    }
  }

  function ensureBeginPlay(canvas, content) {
    // create a Begin Play executor once if not present
    const exists = Array.from(Store.blocks.values()).some(b => (b.data.button_class || '').toLowerCase() === 'executor' && (b.data.id || '').toLowerCase().includes('begin'))
    if (exists) return
    const view = window.BlockFactory.createFromTemplate('Executor', {
      id: 'BeginPlay',
      button_class: 'Executor',
      content: 'Begin Play',
      has_input_executor: false,
      has_output_executor: true,
      variables_input_nodes: [],
      variables_input_nodes_types: [],
      variables_output_nodes: [],
      variables_output_nodes_types: []
    })
    view.el.style.left = '40px'
    view.el.style.top = '40px'
    content.appendChild(view.el)
    addBlockToStore(view.data.uid, view.el, view.data)
    wireBlockEvents(view.el, canvas)
  }

  function wireBlockEvents(blockEl, canvas) {
    // start connection from exec out or var out
    qsa('.exec.out, .port.port-out', blockEl).forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        beginConnectionFrom(el)
      })
    })

    // complete connection to exec in or var in
    qsa('.exec.in, .port.port-in', blockEl).forEach((el) => {
      el.addEventListener('pointerup', (e) => {
        e.stopPropagation()
        const ok = completeConnectionTo(el)
        if (ok) drawConnections(canvas)
      })
    })

    // while dragging blocks, update lines
    blockEl.addEventListener('block:moved', () => drawConnections(canvas))

    // deletion
    blockEl.addEventListener('block:delete', (e) => {
      const uid = e.detail && e.detail.uid
      if (!uid) return
      // remove element
      blockEl.remove()
      // cleanup store
      removeConnectionsForBlock(uid)
      Store.blocks.delete(uid)
      drawConnections(canvas)
    })
  }

  // Global canvas listeners to cancel connection and live-draw preview
  function wireCanvas(canvas) {
    canvas.addEventListener('pointerup', () => cancelConnection())
    canvas.addEventListener('pointerleave', () => cancelConnection())
    
    // Area selection variables
    let isAreaSelecting = false
    let areaSelectionStart = null
    
    // Area selection with Ctrl+drag
    canvas.addEventListener('pointerdown', (e) => {
      // Only handle left mouse button on canvas background
      if (e.button !== 0 || (e.target !== canvas && e.target.id !== 'canvas-content')) return
      
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        
        isAreaSelecting = true
        const canvasRect = canvas.getBoundingClientRect()
        const canvasContent = qs('#canvas-content')
        const transform = getTransform(canvasContent)
        
        // Convert screen coordinates to canvas coordinates
        const canvasX = (e.clientX - canvasRect.left - transform.x) / transform.scale
        const canvasY = (e.clientY - canvasRect.top - transform.y) / transform.scale
        
        areaSelectionStart = { x: canvasX, y: canvasY }
        Store.selectionBox = { startX: canvasX, startY: canvasY, endX: canvasX, endY: canvasY }
        
        canvas.setPointerCapture(e.pointerId)
      } else {
        // Clear selection if clicking on empty canvas without Ctrl
        clearSelection()
      }
    })
    
    canvas.addEventListener('pointermove', (e) => {
      if (!isAreaSelecting || !areaSelectionStart) return
      
      const canvasRect = canvas.getBoundingClientRect()
      const canvasContent = qs('#canvas-content')
      const transform = getTransform(canvasContent)
      
      // Convert screen coordinates to canvas coordinates
      const canvasX = (e.clientX - canvasRect.left - transform.x) / transform.scale
      const canvasY = (e.clientY - canvasRect.top - transform.y) / transform.scale
      
      Store.selectionBox.endX = canvasX
      Store.selectionBox.endY = canvasY
      
      // Update visual selection box
      updateSelectionBox(Store.selectionBox)
      
      // Update block selection based on area
      updateAreaSelection()
    })
    
    canvas.addEventListener('pointerup', (e) => {
      if (isAreaSelecting) {
        isAreaSelecting = false
        areaSelectionStart = null
        
        // Hide selection box
        updateSelectionBox(null)
        Store.selectionBox = null
        
        try { canvas.releasePointerCapture(e.pointerId) } catch (_) {}
      }
    })
    
    // Right-click context menu
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (e.target === canvas || e.target.id === 'canvas-content') {
        showContextMenu(e.clientX, e.clientY)
      }
    })
    
    // Hide context menu on click elsewhere
    document.addEventListener('click', (e) => {
      const contextMenu = qs('#context-menu')
      if (!contextMenu.contains(e.target)) {
        hideContextMenu()
      } else if (e.target.closest('.context-result-item')) {
        // Allow clicks on result items to proceed
        return
      }
    })
  }
  
  function updateAreaSelection() {
    if (!Store.selectionBox) return
    
    // Clear current selection
    clearSelection()
    
    // Check each block to see if it's in the selection area
    for (const [uid, blockInfo] of Store.blocks) {
      if (blockInfo.el && isBlockInSelectionBox(blockInfo.el, Store.selectionBox)) {
        selectBlock(uid, true)
      }
    }
  }

  // Context menu functionality
  function showContextMenu(x, y) {
    const contextMenu = qs('#context-menu')
    const searchInput = qs('#block-search')
    const results = qs('#context-menu-results')
    
    // Position menu
    contextMenu.style.left = x + 'px'
    contextMenu.style.top = y + 'px'
    contextMenu.style.display = 'block'
    
    // Store click position for block placement
    contextMenu._clickX = x
    contextMenu._clickY = y
    
    // Clear and focus search
    searchInput.value = ''
    results.innerHTML = ''
    searchInput.focus()
    
    // Show all blocks initially
    updateContextMenuResults('')
  }

  function hideContextMenu() {
    const contextMenu = qs('#context-menu')
    contextMenu.style.display = 'none'
  }

  function updateContextMenuResults(query) {
    const results = qs('#context-menu-results')
    const lowerQuery = query.toLowerCase()
    
    results.innerHTML = ''
    
    // Filter and sort blocks from Store.availableBlocks
    const matches = []
    for (const [id, blockInfo] of Store.availableBlocks.entries()) {
      const name = blockInfo.name.toLowerCase()
      const desc = (blockInfo.description || '').toLowerCase()
      
      if (!query || name.includes(lowerQuery) || desc.includes(lowerQuery)) {
        matches.push({ 
          ...blockInfo, 
          score: name.indexOf(lowerQuery) === 0 ? 0 : name.indexOf(lowerQuery) >= 0 ? 1 : 2 
        })
      }
    }
    
    matches.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    
    // Create result items
    matches.slice(0, 10).forEach(blockInfo => {
      const item = document.createElement('div')
      item.className = 'context-result-item'
      
      const badge = document.createElement('div')
      badge.className = `context-result-badge ${blockInfo.type}`
      badge.textContent = blockInfo.type
      
      const content = document.createElement('div')
      content.style.flex = '1'
      
      const name = document.createElement('div')
      name.className = 'context-result-name'
      name.textContent = blockInfo.name
      
      content.appendChild(name)
      
      if (blockInfo.description) {
        const desc = document.createElement('div')
        desc.className = 'context-result-desc'
        desc.textContent = blockInfo.description
        content.appendChild(desc)
      }
      
      item.appendChild(badge)
      item.appendChild(content)
      
      item.addEventListener('click', () => {
        createBlockFromContextMenu(blockInfo)
        hideContextMenu()
      })
      
      results.appendChild(item)
    })
    
    if (matches.length === 0) {
      const noResults = document.createElement('div')
      noResults.className = 'context-result-item'
      noResults.style.color = 'var(--muted)'
      noResults.style.fontStyle = 'italic'
      noResults.textContent = 'No blocks found'
      results.appendChild(noResults)
    }
  }

  function createBlockFromContextMenu(blockInfo) {
    const contextMenu = qs('#context-menu')
    const canvas = qs('#canvas')
    const canvasRect = canvas.getBoundingClientRect()
    
    // Convert screen coordinates to canvas coordinates
    const canvasContent = qs('#canvas-content')
    const transform = getTransform(canvasContent)
    
    const canvasX = (contextMenu._clickX - canvasRect.left - transform.x) / transform.scale
    const canvasY = (contextMenu._clickY - canvasRect.top - transform.y) / transform.scale
    
    // Create block from template
    const template = blockInfo.template
    if (template) {
      const view = window.BlockFactory.createFromTemplate(template.button_class, template)
      view.el.style.left = canvasX + 'px'
      view.el.style.top = canvasY + 'px'
      canvasContent.appendChild(view.el)
      addBlockToStore(view.data.uid, view.el, view.data)
      wireBlockEvents(view.el, canvas)
      
      // Redraw connections
      drawConnections(canvas)
    }
  }

  // Helper to get canvas transform
  function getTransform(el) {
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

  // Create variable block from drag
  function createVariableBlockFromDrag(variable, screenX, screenY) {
    const canvas = qs('#canvas')
    const canvasContent = qs('#canvas-content')
    const canvasRect = canvas.getBoundingClientRect()
    const transform = getTransform(canvasContent)
    
    // Convert screen coordinates to canvas coordinates
    const canvasX = (screenX - canvasRect.left - transform.x) / transform.scale
    const canvasY = (screenY - canvasRect.top - transform.y) / transform.scale
    
    // Create variable block
    const template = {
      id: 'Var',
      button_class: 'Variable',
      content: 'Variable source',
      has_input_executor: false,
      has_output_executor: false,
      variables_input_nodes: [],
      variables_input_nodes_types: [],
      variables_output_nodes: ['value'],
      variables_output_nodes_types: ['any'],
      function_name: null,
      variable: variable,
      variable_uid: variable.uid
    }
    
    const blockView = BlockFactory.create(template)
    blockView.setPosition(canvasX, canvasY)
    blockView.render(canvasContent)
    addBlockToStore(blockView.uid, blockView.el, blockView.data)
    
    // Wire events
    const canvas2 = qs('#canvas')
    wireBlockEvents(blockView.el, canvas2)
  }


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady)
  } else {
    onReady()
  }
})()


