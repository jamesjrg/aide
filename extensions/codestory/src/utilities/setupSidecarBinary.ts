/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { window } from 'vscode';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, exec, execFile } from 'child_process';
import { sidecarUseSelfRun } from './sidecarUrl';


// We are going to use a static port right now and nothing else
export function getSidecarBinaryURL() {
	return 'http://127.0.0.1:42424';
}

export async function runCommand(cmd: string): Promise<[string, string | undefined]> {
	let stdout = '';
	let stderr = '';
	try {
		const output = await promisify(exec)(cmd, {
			shell: process.platform === 'win32' ? 'powershell.exe' : undefined,
		});
		stdout = output.stdout;
		stderr = output.stderr;
	} catch (e: any) {
		stderr = e.stderr;
		stdout = e.stdout;
	}

	const stderrOrUndefined = stderr === '' ? undefined : stderr;
	return [stdout, stderrOrUndefined];
}

async function killProcessOnPort(port: number): Promise<void> {
	if (os.platform() === 'win32') {
		// Find the process ID using netstat (this command is for Windows)
		const { stdout, stderr } = await promisify(exec)(`netstat -ano | findstr :${port}`);
		if (stderr) {
			console.error(`exec error: ${stderr}`);
			return;
		}
		const pid = stdout.split(/\s+/).slice(-2, -1)[0];

		if (pid) {
			// Kill the process
			const { stderr } = await promisify(exec)(`taskkill /PID ${pid} /F`);
			if (stderr) {
				console.error(`Error killing process: ${stderr}`);
				return;
			}
		} else {
			// console.log(`No process running on port ${port}`);
		}
	} else {
		// Find the process ID using lsof (this command is for macOS/Linux)
		const { stdout, stderr } = await promisify(exec)(`lsof -i :${port} | grep LISTEN | awk '{print $2}'`);

		if (stderr) {
			console.error(`exec error: ${stderr}`);
		}

		const pid = stdout.trim();

		if (pid) {
			// Kill the process
			const { stderr } = await promisify(execFile)('kill', ['-2', `${pid}`]);
			if (stderr) {
				console.error(`Error killing process: ${stderr}`);
				return;
			}
		} else {
			// console.log(`No process running on port ${port}`);
		}
	}
}

export async function startSidecarBinaryWithLocal(
	sidecarBinPath: string,
): Promise<boolean> {
	const serverUrl = getSidecarBinaryURL();
	return await runSideCarBinary(sidecarBinPath, serverUrl);
}

export async function startSidecarBinary(
	sidecarBinPath: string,
): Promise<string> {
	const sidecarServerUrl = getSidecarBinaryURL();

	const shouldUseSelfRun = sidecarUseSelfRun();
	if (shouldUseSelfRun) {
		return sidecarServerUrl;
	}

	// In theory any existing process should already have been killed when
	// the extension was last deactivated (either by opening a folder or exiting the IDE),
	// so there shouldn't be any server running.
	// But to be on the safe side,
	// check and kill any current process just in case an old version has been left running somehow
	await killSidecarProcess();

	console.log('starting sidecar binary');
	// We want to check where the sidecar binary is stored
	// extension_path: /Users/skcd/.vscode-oss-dev/User/globalStorage/codestory-ghost.codestoryai/sidecar_bin
	// installation location: /Users/skcd/Downloads/Aide.app/Contents/Resources/app/extensions/codestory/sidecar_bin
	// we have to figure out how to copy them together
	// console.log('starting sidecar binary');
	await startSidecarBinaryWithLocal(sidecarBinPath);

	return sidecarServerUrl;
}

export function killSidecarProcess(): Promise<void> {
	return killProcessOnPort(42424);
}

async function runSideCarBinary(sidecarBinPath: string, serverUrl: string) {
	if (os.platform() === 'darwin' || os.platform() === 'linux') {
		// Now we want to change the permissions for the following files:
		// target/release/webserver
		fs.chmodSync(sidecarBinPath, 0o7_5_5);
	}

	if (os.platform() === 'darwin') {
		// We need to run this command on the darwin platform
		await runCommand(`xattr -dr com.apple.quarantine ${sidecarBinPath}`);
	}


	// Validate that the file exists
	if (!fs.existsSync(sidecarBinPath)) {
		const errText = `- Failed to install Sidecar binary.`;
		window.showErrorMessage(errText);
		throw new Error(errText);
	}

	// Run the executable
	// console.log('Starting sidecar binary');
	let attempts = 0;
	// increasing max attempts to 100
	const maxAttempts = 100;
	const delay = 1000; // Delay between each attempt in milliseconds

	const spawnChild = async () => {
		const retry = () => {
			attempts++;
			// console.log(`Error caught (likely EBUSY). Retrying attempt ${attempts}...`);
			setTimeout(spawnChild, delay);
		};
		try {
			const windowsSettings = {
				windowsHide: true,
			};
			const macLinuxSettings = {
			};
			const settings: any = os.platform() === 'win32' ? windowsSettings : macLinuxSettings;

			const child = spawn(sidecarBinPath, settings);

			// Either unref to avoid zombie process, or listen to events because you can
			if (os.platform() === 'win32') {
				child.stdout.on('data', (data: any) => {
					console.log(`stdout: ${data}`);
				});
				child.stderr.on('data', (data: any) => {
					console.log(`stderr: ${data}`);
				});
				child.on('error', (err: any) => {
					if (attempts < maxAttempts) {
						retry();
					} else {
						console.error('Failed to start subprocess.', err);
					}
				});
				child.on('exit', (code: any, signal: any) => {
					console.log('Subprocess exited with code', code, signal);
				});
				child.on('close', (code: any, signal: any) => {
					console.log('Subprocess closed with code', code, signal);
				});
			} else {
				child.unref();
			}
		} catch (e: any) {
			console.log('Error starting server:', e);
			retry();
		}
	};

	await spawnChild();

	const waitForGreenHC = async () => {
		let hcAttempts = 0;
		while (hcAttempts < maxAttempts) {
			try {
				// console.log('Health check main loop');
				const url = `${serverUrl}/api/health`;
				const response = await fetch(url);
				if (response.status === 200) {
					// allow-any-unicode-next-line
					// console.log('HC finished! We are green 🛳️');
					return true;
				} else {
					// console.log(`HC failed, trying again. Attempt ${hcAttempts + 1}`);
				}
			} catch (e: any) {
				// console.log(`HC failed, trying again. Attempt ${hcAttempts + 1}`, e);
			}
			hcAttempts++;
			await new Promise(resolve => setTimeout(resolve, delay));
		}
		return false;
	};

	// console.log('we are returning from HC check');
	const hcGreen = await waitForGreenHC();
	// console.log('HC value: ', hcGreen);
	if (!hcGreen) {
		// console.log('Failed to start sidecar');
		return false;
	}
	return true;
}
