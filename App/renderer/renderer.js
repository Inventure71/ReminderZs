;(function () {
  function qs(sel, root) { return (root || document).querySelector(sel) }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)) }

  // Simple in-memory store for blocks and connections
  const Store = {
    blocks: new Map(), // uid -> { uid, id, el, data }
    // Exec connections: key `${fromUid}:exec:${outKey}` → { toUid, toExecKey?, toExecIndex? }
    exec: new Map(),
    // Variable connections: key `${fromUid}:out:${outIndex}` → { toUid, inIndex } (single target per output)
    vars: new Map(),
    // Variables catalogue: varUid → { uid, name, type, value, is_global, global_id, local_id }
    variables: new Map(),
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
    for (const [key, val] of Array.from(Store.vars.entries())) {
      const [fromUid] = key.split(':out:')
      if (fromUid === uid || (val && val.toUid === uid)) {
        Store.vars.delete(key)
      }
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
    Store.vars.forEach((val, key) => {
      const [fromUid, , outIndexStr] = key.split(':')
      const fromBlock = Store.blocks.get(fromUid)
      if (!fromBlock || !val) return
      const fromPort = fromBlock.el.querySelector(`.port-out[data-index="${outIndexStr}"]`) || fromBlock.el.querySelector(`.port.port-out[data-index="${outIndexStr}"]`)
      const toBlock = Store.blocks.get(val.toUid)
      if (!toBlock) return
      const toPort = toBlock.el.querySelector(`.port-in[data-index="${val.inIndex}"]`) || toBlock.el.querySelector(`.port.port-in[data-index="${val.inIndex}"]`)
      if (!fromPort || !toPort) return
      const a = computeAnchor(fromPort)
      const b = computeAnchor(toPort)
      svg.appendChild(createPath(a, b, 'var'))
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
      // enforce single target per variable output port
      Store.vars.set(key, { toUid: blockUid, inIndex })
      // ensure uniqueness of incoming per target input by clearing other outputs pointing to same input
      for (const [k, v] of Array.from(Store.vars.entries())) {
        if (k !== key && v && v.toUid === blockUid && v.inIndex === inIndex) {
          Store.vars.delete(k)
        }
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
        extra_context_string: data.extra_context_string || null
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
        for (const [k, v] of Store.vars.entries()) {
          if (v && v.toUid === uid && v.inIndex === i) {
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
        py.variables_input_references.push(ref)
      }
      // For outputs, mark where they are connected to (standardized: per-output ref or null; single target enforced)
      const outputCount = py.variables_output_nodes.length
      for (let o = 0; o < outputCount; o++) {
        const key = `${uid}:out:${o}`
        const v = Store.vars.get(key)
        if (!v) { py.variables_output_references.push(null); continue }
        const target = Store.blocks.get(v.toUid)
        if (target && (target.data.button_class || '').toLowerCase() === 'variable') {
          py.variables_output_references.push(target.data.variable_uid || target.uid)
        } else {
          py.variables_output_references.push(`${v.toUid}:in:${v.inIndex}`)
        }
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
      for (const [key, v] of Store.vars.entries()) {
        const [fromUid] = key.split(':out:')
        if (fromUid !== b.uid) continue
        if (!v) continue
        if (include.has(v.toUid)) { include.add(b.uid); break }
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
          const el = document.createElement('button')
          el.type = 'button'
          el.className = 'pal-item function'
          el.textContent = `${fn.module_name}.${fn.name}`
          el.title = (fn.docstring || '')
          el.addEventListener('click', () => {
            const inputs = (fn.inputs || []).filter(p => !['vararg','varkw'].includes(p.kind)).map(p => p.name)
            const inputTypes = (fn.inputs || []).filter(p => !['vararg','varkw'].includes(p.kind)).map(p => p.annotation || 'any')
            const outName = 'result'
            const outType = fn.output || 'any'
            const view = window.BlockFactory.createFromTemplate('Function', {
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
            })
            view.el.style.left = Math.round(Math.random() * 400 + 40) + 'px'
            view.el.style.top = Math.round(Math.random() * 300 + 40) + 'px'
            content.appendChild(view.el)
            addBlockToStore(view.data.uid, view.el, view.data)
            wireBlockEvents(view.el, canvas)
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
    const Variables = {
      list: [], // { name, type, value, uid, is_global?, global_id?, local_id? }
    }

    function renderVariables() {
      varsList.innerHTML = ''
      Variables.list.forEach((v) => {
        const el = document.createElement('div')
        el.className = 'var-item'
        el.draggable = true
        el.innerHTML = `<span class="name">${v.name}</span><span class="type">${v.type || 'any'}</span>`
        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/x-var', JSON.stringify(v))
        })
        el.addEventListener('click', () => showInspectorForVar(v))
        varsList.appendChild(el)
      })
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

    // Allow dropping variable onto canvas to create a Variable block bound to that variable uid
    canvas.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-var')) e.preventDefault()
    })
    canvas.addEventListener('drop', (e) => {
      const data = e.dataTransfer.getData('application/x-var')
      if (!data) return
      e.preventDefault()
      const v = JSON.parse(data)
      const view = window.BlockFactory.createFromTemplate('Variable', {
        id: 'Variable',
        button_class: 'Variable',
        content: `Variable ${v.name}`,
        variable_uid: v.uid,
        variables_output_nodes: ['value'],
        variables_output_nodes_types: [v.type || 'any']
      })
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
      view.el.style.left = (cx - 40) + 'px'
      view.el.style.top = (cy - 20) + 'px'
      content.appendChild(view.el)
      addBlockToStore(view.data.uid, view.el, view.data)
      wireBlockEvents(view.el, canvas)
    })
  }

  function addBuiltinBlocks(container, canvas, content) {
    const builtins = [
      { name: 'Print', cls: 'Function', fn: 'builtins.print', inputs: ['value'], inputTypes: ['any'], out: null, outType: null, content: 'Print value' },
      { name: 'Add', cls: 'Function', fn: 'math_add', inputs: ['a','b'], inputTypes: ['number','number'], out: 'sum', outType: 'number', content: 'Add two numbers' },
      { name: 'Max', cls: 'Function', fn: 'math_max', inputs: ['a','b'], inputTypes: ['number','number'], out: 'max', outType: 'number', content: 'Max of two' },
      { name: 'Var', cls: 'Variable', fn: null, inputs: [], inputTypes: [], out: 'value', outType: 'any', content: 'Variable source' },
      { name: 'If', cls: 'Conditional', fn: 'flow_if', inputs: ['condition'], inputTypes: ['bool'], out: null, outType: null, content: 'If condition' },
    ]
    builtins.forEach((b) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'pal-item ' + b.cls.toLowerCase()
      el.textContent = b.name
      el.addEventListener('click', () => {
        const overrides = {
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
        const view = window.BlockFactory.createFromTemplate(b.cls, overrides)
        view.el.style.left = Math.round(Math.random() * 400 + 40) + 'px'
        view.el.style.top = Math.round(Math.random() * 300 + 40) + 'px'
        content.appendChild(view.el)
        addBlockToStore(view.data.uid, view.el, view.data)
        wireBlockEvents(view.el, canvas)
      })
      container.appendChild(el)
    })
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
  }


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady)
  } else {
    onReady()
  }
})()


