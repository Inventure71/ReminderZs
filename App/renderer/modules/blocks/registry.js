;(function () {
  const templates = new Map()

  function registerTemplate(name, template) {
    if (!name || typeof name !== 'string') throw new Error('Template name required')
    const normalized = {
      id: '',
      content: template.content || '',
      button_class: name,
      has_input_executor: Boolean(template.has_input_executor),
      has_output_executor: Boolean(template.has_output_executor),
      variables_input_notes: Array.isArray(template.variables_input_notes) ? template.variables_input_notes : [],
      variables_input_notes_types: Array.isArray(template.variables_input_notes_types) ? template.variables_input_notes_types : [],
      variables_output_notes: Array.isArray(template.variables_output_notes) ? template.variables_output_notes : [],
      variables_output_notes_types: Array.isArray(template.variables_output_notes_types) ? template.variables_output_notes_types : []
    }
    templates.set(name, Object.freeze(normalized))
  }

  function getTemplate(name) {
    return templates.get(name) || null
  }

  function listTemplates() {
    return Array.from(templates.keys())
  }

  function getAll() {
    return Array.from(templates.entries()).map(([name, template]) => ({ name, template }))
  }

  // Default templates matching the Python Block model's semantics
  function registerDefaults() {
    registerTemplate('Executor', {
      content: 'Executes next block',
      has_input_executor: true,
      has_output_executor: true,
      exec_input_nodes: ['in'],
      exec_output_nodes: ['out'],
      variables_input_notes: [],
      variables_input_notes_types: [],
      variables_output_notes: [],
      variables_output_notes_types: []
    })

    registerTemplate('Function', {
      content: 'Function block',
      has_input_executor: true,
      has_output_executor: true,
      exec_input_nodes: ['in'],
      exec_output_nodes: ['out'],
      variables_input_notes: ['input'],
      variables_input_notes_types: ['any'],
      variables_output_notes: ['result'],
      variables_output_notes_types: ['any']
    })

    registerTemplate('Variable', {
      content: 'Variable source',
      has_input_executor: false,
      has_output_executor: false,
      exec_input_nodes: [],
      exec_output_nodes: [],
      variables_input_nodes: [],
      variables_input_nodes_types: [],
      variables_output_nodes: ['value'],
      variables_output_nodes_types: ['any']
    })

    registerTemplate('Conditional', {
      content: 'If condition',
      has_input_executor: true,
      has_output_executor: true, // two exec outs
      exec_input_nodes: ['in'],
      exec_output_nodes: ['then', 'else'],
      variables_input_nodes: ['condition'],
      variables_input_nodes_types: ['bool'],
      variables_output_nodes: [],
      variables_output_nodes_types: []
    })
  }

  registerDefaults()

  window.BlockRegistry = { registerTemplate, getTemplate, listTemplates, getAll }
})()


