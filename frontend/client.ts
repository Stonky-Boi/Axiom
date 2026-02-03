import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";

export class AxiomClient {
    private process: cp.ChildProcess | null = null;
    private outputChannel: vscode.OutputChannel;

    constructor(context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel("Axiom Core");
        this.startServer(context);
    }

    private getPythonPath(context: vscode.ExtensionContext): string {
        const venvRoot = path.join(context.extensionPath, "venv");
        const pythonUnix = path.join(venvRoot, "bin", "python");
        const pythonWin = path.join(venvRoot, "Scripts", "python.exe");

        if (fs.existsSync(pythonUnix)) {
            return pythonUnix;
        }
        if (fs.existsSync(pythonWin)) {
            return pythonWin;
        }

        this.outputChannel.appendLine("[Warning] 'venv' not found. Using system Python.");
        return "python";
    }

    private startServer(context: vscode.ExtensionContext) {
        const scriptPath = path.join(context.extensionPath, "backend", "server.py");
        const backendDir = path.join(context.extensionPath, "backend");
        const pythonPath = this.getPythonPath(context);

        this.outputChannel.appendLine(`[Client] Using Python Interpreter: ${pythonPath}`);
        
        this.process = cp.spawn(pythonPath, ["-u", scriptPath], {
            cwd: backendDir 
        });

        this.process.stderr?.on("data", (data) => {
            this.outputChannel.appendLine(`[Server Error]: ${data}`);
        });

        this.process.stdout?.on("data", (data) => {
            const str = data.toString();
            if (!str.trim().startsWith("{")) {
                this.outputChannel.appendLine(`[Server Log]: ${str.trim()}`);
            }
        });

        this.process.on("close", (code) => {
            this.outputChannel.appendLine(`Server stopped with code ${code}`);
        });

        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.sendRequest("initialize", { root: rootPath }).catch(console.error);
        }
    }

    public async sendRequest(command: string, data: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.process || !this.process.stdin) {
                return reject("Server not running");
            }

            const payload = JSON.stringify({ command, data }) + "\n";
            this.process.stdin.write(payload);

            const handler = (response: Buffer) => {
                const str = response.toString().trim();
                if (!str.startsWith("{")) {
                    return;
                }

                try {
                    const json = JSON.parse(str);
                    this.process?.stdout?.off("data", handler);
                    resolve(json);
                } catch (e) { }
            };

            this.process.stdout?.on("data", handler);
            
            // TIMEOUT FIX: Increased to 60 seconds (60000ms) for Chat
            setTimeout(() => {
                this.process?.stdout?.off("data", handler);
                reject("Request timed out (60s limit)");
            }, 60000);
        });
    }

    public dispose() {
        this.process?.kill();
    }
}