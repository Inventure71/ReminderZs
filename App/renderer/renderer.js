;(function () {
  function qs(sel, root) { return (root || document).querySelector(sel) }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)) }

  // Simple in-memory store for blocks and connections
  const Store = {
    blocks: new Map(), // uid -> { uid, id, el, data }
    // Connections
    exec: new Map(),   // fromUid -> toUid (linked-list semantics)
    vars: new Map(),   // key "fromUid:out:index" -> { toUid, inIndex }
  }

  function addBlockToStore(uid, el, data) {
    Store.blocks.set(uid, { uid, id: data.id, el, data })
  }

  function removeConnectionsForBlock(id) {
    Store.exec.delete(id)
    Array.from(Store.exec.entries()).forEach(([from, to]) => { if (to === id) Store.exec.delete(from) })
    Array.from(Store.vars.keys()).forEach((k) => {
      if (k.startsWith(id + ':')) Store.vars.delete(k)
    })
    Array.from(Store.vars.entries()).forEach(([k, v]) => {
      if (v.toUid === id) Store.vars.delete(k)
    })
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
    const parent = el.closest('.canvas')
    const target = el.querySelector && el.querySelector('.port-dot') ? el.querySelector('.port-dot') : el
    const r = target.getBoundingClientRect()
    const pr = parent.getBoundingClientRect()
    return { x: r.left - pr.left + r.width / 2, y: r.top - pr.top + r.height / 2 }
  }

  function drawConnections(canvas) {
    const svg = ensureSvgLayer(canvas)
    svg.innerHTML = ''

    // Exec connections (one per fromBlock)
    Store.exec.forEach((toUid, fromUid) => {
      const fromBlock = Store.blocks.get(fromUid)
      const toBlock = Store.blocks.get(toUid)
      if (!fromBlock || !toBlock) return
      const fromPort = fromBlock.el.querySelector('.exec.out')
      const toPort = toBlock.el.querySelector('.exec.in')
      if (!fromPort || !toPort) return
      const a = computeAnchor(fromPort)
      const b = computeAnchor(toPort)
      svg.appendChild(createPath(a, b, 'exec'))
    })

    // Var connections
    Store.vars.forEach(({ toUid, inIndex }, key) => {
      const [fromUid, , outIndexStr] = key.split(':')
      const fromBlock = Store.blocks.get(fromUid)
      const toBlock = Store.blocks.get(toUid)
      if (!fromBlock || !toBlock) return
      const fromPort = fromBlock.el.querySelector(`.port-out[data-index="${outIndexStr}"]`) || fromBlock.el.querySelector(`.port.port-out[data-index="${outIndexStr}"]`)
      const toPort = toBlock.el.querySelector(`.port-in[data-index="${inIndex}"]`) || toBlock.el.querySelector(`.port.port-in[data-index="${inIndex}"]`)
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
      // One-to-one linked list: each block can only have one outgoing and one incoming exec connection
      // Remove any existing outgoing from fromBlockId
      Store.exec.delete(ConnectState.active.fromUid)
      // Also ensure only one incoming per target: remove others pointing to this block
      Array.from(Store.exec.entries()).forEach(([from, to]) => {
        if (to === blockUid) Store.exec.delete(from)
      })
      if (ConnectState.active.fromUid !== blockUid) {
        Store.exec.set(ConnectState.active.fromUid, blockUid)
      }
    } else if (isVar) {
      const fromUid = ConnectState.active.fromUid
      const outIndex = ConnectState.active.outIndex || 0
      const key = `${fromUid}:out:${outIndex}`
      const inIndex = Number(el.dataset.index) || 0
      // enforce single connection per port: clear any existing connections involving these ports
      Store.vars.delete(key)
      Array.from(Store.vars.entries()).forEach(([k, v]) => {
        if (v.toUid === blockUid && v.inIndex === inIndex) Store.vars.delete(k)
      })
      if (fromUid !== blockUid) {
        Store.vars.set(key, { toUid: blockUid, inIndex })
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
        variables_input_nodes: Array.isArray(data.variables_input_nodes) ? data.variables_input_nodes : [],
        variables_input_nodes_types: Array.isArray(data.variables_input_nodes_types) ? data.variables_input_nodes_types : [],
        variables_output_nodes: Array.isArray(data.variables_output_nodes) ? data.variables_output_nodes : [],
        variables_output_nodes_types: Array.isArray(data.variables_output_nodes_types) ? data.variables_output_nodes_types : [],
        in_connection_id: null,
        out_connection_id: null,
        variables_input_references: [],
        variables_output_references: [],
        function_name: data.function_name || null,
        extra_context_string: data.extra_context_string || null
      }

      // Exec linked list references
      if (Store.exec.has(uid)) py.out_connection_id = Store.exec.get(uid)
      // find incoming
      const incoming = Array.from(Store.exec.entries()).find(([, to]) => to === uid)
      if (incoming) py.in_connection_id = incoming[0]

      // Variable references: for each input index, find any incoming
      const inputCount = py.variables_input_nodes.length
      for (let i = 0; i < inputCount; i++) {
        const match = Array.from(Store.vars.entries()).find(([, v]) => v.toUid === uid && v.inIndex === i)
        // For variable blocks, use the variable UID; for others, use fromUid:out:index key
        if (match) {
          const [fromUid, , outIndexStr] = match[0].split(':')
          const src = Store.blocks.get(fromUid)
          if (src && (src.data.button_class || '').toLowerCase() === 'variable') {
            py.variables_input_references.push(src.data.variable_uid || src.uid)
          } else {
            py.variables_input_references.push(match[0])
          }
        } else {
          py.variables_input_references.push(null)
        }
      }
      // For outputs, mark where they are connected to
      const outputCount = py.variables_output_nodes.length
      for (let o = 0; o < outputCount; o++) {
        const key = `${uid}:out:${o}`
        const v = Store.vars.get(key)
        if (v) {
          const target = Store.blocks.get(v.toUid)
          if (target && (target.data.button_class || '').toLowerCase() === 'variable') {
            py.variables_output_references.push(target.data.variable_uid || target.uid)
          } else {
            py.variables_output_references.push(`${v.toUid}:in:${v.inIndex}`)
          }
        } else {
          py.variables_output_references.push(null)
        }
      }

      result.push(py)
    })
    return result
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
    const form = qs('#block-form')
    const inputsList = qs('#inputs-list')
    const outputsList = qs('#outputs-list')
    const addInputBtn = qs('#add-input-var')
    const addOutputBtn = qs('#add-output-var')
    const canvas = qs('#canvas')
    const palette = qs('#block-palette')
    const compileBtn = qs('#compile-btn')
    const compileOut = qs('#compile-output')

    addInputBtn.addEventListener('click', () => addVarRow(inputsList))
    addOutputBtn.addEventListener('click', () => addVarRow(outputsList))

    // start with one row each for convenience
    addVarRow(inputsList)
    addVarRow(outputsList)

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const fd = new FormData(form)
      const inputVars = collectVars(inputsList)
      const outputVars = collectVars(outputsList)

      const blockData = {
        id: (fd.get('id') || '').toString().trim(),
        content: (fd.get('content') || '').toString(),
        button_class: (fd.get('button_class') || '').toString() || null,
        has_input_executor: fd.get('has_input_executor') === 'on',
        has_output_executor: fd.get('has_output_executor') === 'on',
        variables_input_notes: inputVars.names,
        variables_input_notes_types: inputVars.types,
        variables_output_notes: outputVars.names,
        variables_output_notes_types: outputVars.types,
        function_name: (fd.get('function_name') || '').toString() || null,
        extra_context_string: (fd.get('extra_context_string') || '').toString() || null
      }

      if ((blockData.button_class || '').toLowerCase() === 'variable') {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
          blockData.variable_uid = crypto.randomUUID()
        } else {
          blockData.variable_uid = 'var-' + Math.random().toString(36).slice(2)
        }
      }

      const view = new window.BlockView(blockData)
      view.el.style.left = Math.round(Math.random() * 400 + 40) + 'px'
      view.el.style.top = Math.round(Math.random() * 300 + 40) + 'px'
      canvas.appendChild(view.el)
      addBlockToStore(view.data.uid, view.el, view.data)
      wireBlockEvents(view.el, canvas)

      if (window.blocksApi && typeof window.blocksApi.create === 'function') {
        window.blocksApi.create(blockData)
      }
    })

    if (window.blocksApi && typeof window.blocksApi.list === 'function') {
      window.blocksApi.list().then((blocks) => {
        (blocks || []).forEach((b, idx) => {
          const view = new window.BlockView(b)
          view.el.style.left = 40 + (idx * 40) + 'px'
          view.el.style.top = 40 + (idx * 30) + 'px'
          canvas.appendChild(view.el)
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

    // Palette population
    if (window.BlockRegistry && typeof window.BlockRegistry.getAll === 'function') {
      const templates = window.BlockRegistry.getAll()
      templates.forEach(({ name }) => {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'pal-item ' + name.toLowerCase()
        el.textContent = name
        el.addEventListener('click', () => {
          const view = window.BlockFactory.createFromTemplate(name, {
            id: name,
            uid: (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('uid-' + Math.random().toString(36).slice(2)))
          })
          view.el.style.left = Math.round(Math.random() * 400 + 40) + 'px'
          view.el.style.top = Math.round(Math.random() * 300 + 40) + 'px'
          canvas.appendChild(view.el)
          addBlockToStore(view.data.uid, view.el, view.data)
          wireBlockEvents(view.el, canvas)
        })
        palette.appendChild(el)
      })
    }

    // Global canvas wire
    wireCanvas(canvas)

    // Compile action
    compileBtn.addEventListener('click', () => {
      const out = window.CompileBridge.toPython()
      compileOut.textContent = JSON.stringify(out, null, 2)
      if (window.blocksApi && typeof window.blocksApi.create === 'function') {
        // emit for backend if desired; you can listen to blocks:created
        window.blocksApi.create({ kind: 'compile', payload: out })
      }
    })
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


