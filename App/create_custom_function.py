#!/usr/bin/env python3
"""
Create custom function stub files for ReminderZs custom blocks.
This script receives a custom block definition via JSON and creates
a Python function stub in the modules/custom_functions/ directory.
"""

import sys
import json
import os
from pathlib import Path
from typing import Dict, List, Any
from datetime import datetime

def create_custom_function_stub(custom_block: Dict[str, Any]) -> bool:
    """Create a Python function stub file for a custom block."""
    try:
        # Extract custom block info
        name = custom_block.get('name', '').strip()
        description = custom_block.get('description', '').strip()
        instructions = custom_block.get('instructions', '').strip()
        inputs = custom_block.get('inputs', [])
        outputs = custom_block.get('outputs', [])
        created = custom_block.get('created', datetime.now().isoformat())
        
        if not name:
            print("Error: Custom block name is required", file=sys.stderr)
            return False
        
        # Validate function name
        if not name.isidentifier():
            print(f"Error: '{name}' is not a valid Python identifier", file=sys.stderr)
            return False
        
        # Create custom_functions directory if it doesn't exist
        custom_functions_dir = Path(__file__).parent / "modules" / "custom_functions"
        custom_functions_dir.mkdir(parents=True, exist_ok=True)
        
        # Create __init__.py if it doesn't exist
        init_file = custom_functions_dir / "__init__.py"
        if not init_file.exists():
            init_file.write_text("# Custom functions module\n")
        
        # Create the function stub file
        stub_file = custom_functions_dir / f"{name}.py"
        
        # Generate type annotations
        def get_type_annotation(param_type: str) -> str:
            type_map = {
                'str': 'str',
                'int': 'int', 
                'float': 'float',
                'bool': 'bool',
                'any': 'Any'
            }
            return type_map.get(param_type, 'Any')
        
        # Build function signature
        params = []
        for inp in inputs:
            param_name = inp.get('name', '').strip()
            param_type = inp.get('type', 'any').strip()
            if param_name:
                type_annotation = get_type_annotation(param_type)
                params.append(f"{param_name}: {type_annotation}")
        
        # Determine return type
        if not outputs:
            return_type = "None"
        elif len(outputs) == 1:
            return_type = get_type_annotation(outputs[0].get('type', 'any'))
        else:
            # Multiple outputs - return tuple
            output_types = [get_type_annotation(out.get('type', 'any')) for out in outputs]
            return_type = f"Tuple[{', '.join(output_types)}]"
        
        # Generate the stub content
        stub_content = f'''"""
Custom function: {name}

Generated on: {created}
Description: {description or 'No description provided'}

Implementation Instructions:
{instructions or 'No specific instructions provided'}

This is an auto-generated stub file. Implement the function logic below.
"""

from typing import Any, Tuple, Union, Optional

def {name}({', '.join(params)}) -> {return_type}:
    """
    {description or f'Custom function: {name}'}
    
    Args:'''
        
        # Add parameter documentation
        for inp in inputs:
            param_name = inp.get('name', '').strip()
            param_type = inp.get('type', 'any').strip()
            if param_name:
                stub_content += f"\n        {param_name} ({param_type}): Input parameter"
        
        stub_content += f"""
    
    Returns:
        {return_type}: """
        
        # Add return documentation
        if not outputs:
            stub_content += "None"
        elif len(outputs) == 1:
            out_name = outputs[0].get('name', '').strip()
            out_type = outputs[0].get('type', 'any').strip()
            stub_content += f"{out_name} ({out_type})" if out_name else f"Result ({out_type})"
        else:
            output_docs = []
            for out in outputs:
                out_name = out.get('name', '').strip()
                out_type = out.get('type', 'any').strip()
                if out_name:
                    output_docs.append(f"{out_name} ({out_type})")
            stub_content += f"Tuple containing: {', '.join(output_docs)}"
        
        stub_content += f'''
    
    Implementation Instructions:
    {instructions or 'Implement the custom logic for this function'}
    """
    # TODO: Implement your custom logic here
    
    # Example implementation (replace with your actual logic):
    '''
        
        if not outputs:
            stub_content += '''pass  # Function returns None
    
    # Example: print("Hello from custom function!")
    # return None'''
        elif len(outputs) == 1:
            out_type = outputs[0].get('type', 'any').strip()
            if out_type == 'str':
                stub_content += '''return "result"  # Replace with actual string result'''
            elif out_type == 'int':
                stub_content += '''return 0  # Replace with actual integer result'''
            elif out_type == 'float':
                stub_content += '''return 0.0  # Replace with actual float result'''
            elif out_type == 'bool':
                stub_content += '''return True  # Replace with actual boolean result'''
            else:
                stub_content += '''return None  # Replace with actual result'''
        else:
            # Multiple outputs
            example_returns = []
            for out in outputs:
                out_type = out.get('type', 'any').strip()
                if out_type == 'str':
                    example_returns.append('"result"')
                elif out_type == 'int':
                    example_returns.append('0')
                elif out_type == 'float':
                    example_returns.append('0.0')
                elif out_type == 'bool':
                    example_returns.append('True')
                else:
                    example_returns.append('None')
            
            stub_content += f'''return ({', '.join(example_returns)})  # Replace with actual results'''
        
        # Write the stub file
        stub_file.write_text(stub_content)
        
        print(f"Custom function stub created: {stub_file}")
        print(f"Function name: {name}")
        print(f"Module path: custom_functions.{name}")
        
        return True
        
    except Exception as e:
        print(f"Error creating custom function stub: {e}", file=sys.stderr)
        return False

def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python create_custom_function.py '<custom_block_json>'", file=sys.stderr)
        sys.exit(1)
    
    try:
        custom_block_json = sys.argv[1]
        custom_block = json.loads(custom_block_json)
        
        success = create_custom_function_stub(custom_block)
        sys.exit(0 if success else 1)
        
    except json.JSONDecodeError as e:
        print(f"Invalid JSON: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
