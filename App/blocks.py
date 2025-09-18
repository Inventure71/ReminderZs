

class Variable:
    def __init__(self, name: str, type: str, value: any):
        """
        Variable is a class that represents a variable in the block.
        """
        self.name = name
        self.type = type
        self.value = value
        self.global_id = None
        self.local_id = None
        self.is_global = False


class Block:
    def __init__(self, id: str, uid: str, content: str):
        self.id = id # id of the block class
        self.uid = uid # uid of the block instance
        self.button_class = None # "Executor", "Function", "Variable", "Conditional"
        self.has_input_executor = False
        self.has_output_executor = False
        self.variables_input_nodes = [] # list of names of variables that are input to the block
        self.variables_input_nodes_types = [] # list of types of variables that are input to the block
        self.variables_output_nodes = [] # list of names of variables that are output from the block
        self.variables_output_nodes_types = [] # list of types of variables that are output from the block

        self.out_connection_id = None
        self.in_connection_id = None
        self.variables_input_references = [] # list of references of variables that are input to the block
        self.variables_output_references = [] # list of references of variables that are output from the block
        self.function_name = None # name of the function to call if the block is a function
        self.extra_context_string = None # string of text that can be left by the user on the specific block
        
        """
        Executor input node is used to connect the previous node to this one, which means that this block will execute once the one connected to it has executed.
        Executor output node is used to connect the next node to this one, which will execute the block connected when this one finished (passing the torch to the next block).
        Input and Output Variables nodes are ways to connect references of variables.
        """

    def build_from_json(self, json_data: dict):
        """
        Build a block from a json data.
        """
        self.id = json_data['id']
        self.button_class = json_data['button_class']
        self.has_input_executor = json_data['has_input_executor']
        self.has_output_executor = json_data['has_output_executor']
        self.variables_input_nodes = json_data['variables_input_nodes']
        self.variables_input_nodes_types = json_data['variables_input_nodes_types']
        self.variables_output_nodes = json_data['variables_output_nodes']
        self.variables_output_nodes_types = json_data['variables_output_nodes_types']
        self.out_connection_id = json_data['out_connection_id']
        self.in_connection_id = json_data['in_connection_id']
        self.variables_input_references = json_data['variables_input_references']
        self.variables_output_references = json_data['variables_output_references']

    def to_json(self) -> dict:
        """
        Convert the block to a json data.
        """
        return {
            'id': self.id,
            'button_class': self.button_class,
            'has_input_executor': self.has_input_executor,
            'has_output_executor': self.has_output_executor,
            'variables_input_nodes': self.variables_input_nodes,
            'variables_input_nodes_types': self.variables_input_nodes_types,
            'variables_output_nodes': self.variables_output_nodes,
            'variables_output_nodes_types': self.variables_output_nodes_types,
            'out_connection_id': self.out_connection_id,
            'in_connection_id': self.in_connection_id,
            'variables_input_references': self.variables_input_references,
            'variables_output_references': self.variables_output_references
        }