;(function () {
  function createFromTemplate(name, overrides) {
    const base = (window.BlockRegistry && window.BlockRegistry.getTemplate(name)) || null
    if (!base) throw new Error('Unknown block template: ' + name)
    const data = Object.assign({}, base, overrides || {})
    // enforce class constraints at creation time
    if ((name || '').toLowerCase() === 'variable') {
      data.has_input_executor = false
      data.has_output_executor = false
      data.variables_input_nodes = []
      data.variables_input_nodes_types = []
      const outName = data.variables_output_nodes && data.variables_output_nodes[0] ? data.variables_output_nodes[0] : 'value'
      const outType = data.variables_output_nodes_types && data.variables_output_nodes_types[0] ? data.variables_output_nodes_types[0] : 'any'
      data.variables_output_nodes = [outName]
      data.variables_output_nodes_types = [outType]
      // assign a variable UID if missing
      const genUid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('var-' + Math.random().toString(36).slice(2)))
      if (!data.variable_uid) data.variable_uid = genUid()
    }
    return new window.BlockView(data)
  }

  function createCustom(data) {
    return new window.BlockView(data || {})
  }

  window.BlockFactory = { createFromTemplate, createCustom }
})()


