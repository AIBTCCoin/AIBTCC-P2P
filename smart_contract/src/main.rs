// smart_contract/src/main.rs

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

#[derive(Serialize, Deserialize, Clone)]
struct ContractState {
    counter: u64,
}

#[derive(Serialize, Deserialize)]
struct Request {
    method: String,
    params: serde_json::Value,
    state: Option<ContractState>, 
}

#[derive(Serialize, Deserialize)]
struct Response {
    result: serde_json::Value,
    state: ContractState,
}

fn emit_event<T: Serialize + ?Sized>(event_name: &str, data: &T) {
    let event = serde_json::json!({
        "event": event_name,
        "data": data
    });
    eprintln!("{}", event.to_string()); // Use eprintln! to write to stderr
    io::stderr().flush().unwrap();
}

fn emit_response<T: Serialize>(data: &T) {
    let response = serde_json::to_string(data).expect("Failed to serialize response");
    println!("{}", response);
    io::stdout().flush().unwrap();
}

fn list_methods() -> Vec<&'static str> {
    vec!["initialize", "increment"]
}

fn main() {
    let stdin = io::stdin();
    let mut state = ContractState { counter: 0 };

    // Read a single line (command) from stdin
    let input = stdin.lock().lines().next();
    if let Some(Ok(line)) = input {
        let request: Request = match serde_json::from_str(&line) {
            Ok(req) => req,
            Err(_) => {
                emit_event("Error", "Invalid JSON input");
                let response = Response {
                    result: serde_json::json!(null),
                    state: state.clone(),
                };
                emit_response(&response);
                std::process::exit(1); 
            }
        };

        // Update state if provided
        if let Some(provided_state) = request.state {
            state = provided_state;
        }

        let method = request.method.as_str();

        match method {
            "initialize" => {
                state.counter = 0;
                emit_event("Initialized", &state);
                let response = Response {
                    result: serde_json::json!(null), // Provide a null or meaningful result
                    state: state.clone(),
                };
                emit_response(&response);
                std::process::exit(0);
            }
            "increment" => {
                state.counter += 1;
                emit_event("CounterIncremented", &state);
                let response = Response {
                    result: serde_json::json!(null), // Provide a null or meaningful result
                    state: state.clone(),
                };
                emit_response(&response);
                std::process::exit(0);
            }
            "list_methods" => {
                let methods = list_methods();
                let response = Response {
                    result: serde_json::json!(methods),
                    state: state.clone(),
                };
                emit_response(&response);
                std::process::exit(0); 
            }
            _ => {
                emit_event("Error", "Unknown method");
                let response = Response {
                    result: serde_json::json!(null), // Provide a null or meaningful result
                    state: state.clone(),
                };
                emit_response(&response);
                std::process::exit(1);
            }
        }

    } else {
        emit_event("Error", "No input received");
        let response = Response {
            result: serde_json::json!(null),
            state: state.clone(),
        };
        emit_response(&response);
        std::process::exit(1); 
    }
}