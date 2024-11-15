/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { window, ProgressLocation } from 'vscode';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, spawnSync, exec, execFile } from 'child_process';
import { downloadFromGCPBucket, downloadUsingURL } from './gcpBucket';
import { sidecarUseSelfRun } from './sidecarUrl';


// Here I want to ask a question about what value does the extracDir take
// it should be pretty easy to do that
function unzipSidecarZipFolder(source: string, extractDir: string) {
	if (source.endsWith('.zip')) {
		if (process.platform === 'win32') {
			spawnSync('powershell.exe', [
				'-NoProfile',
				'-ExecutionPolicy', 'Bypass',
				'-NonInteractive',
				'-NoLogo',
				'-Command',
				`Microsoft.PowerShell.Archive\\Expand-Archive -Path "${source}" -DestinationPath "${extractDir}"`
			]);
		} else {
			spawnSync('unzip', ['-o', source, '-d', `${extractDir}`]);
		}
	} else {
		// tar does not create extractDir by default
		if (!fs.existsSync(extractDir)) {
			fs.mkdirSync(extractDir);
		}
		spawnSync('tar', ['-xzf', source, '-C', extractDir, '--strip-components', '1']);
	}
}

// We are going to use a static port right now and nothing else
export function getSidecarBinaryURL() {
	return 'http://127.0.0.1:42424';
}

// We are hardcoding the version of the sidecar binary here, so we can figure out
// if the version we are looking at is okay, or we need to download a new binary
// for now, lets keep it as it is and figure out a way to update the hash on
// important updates
export const SIDECAR_VERSION = '6e8aaed22c2c4a3331ccea298df96dc5fc1bb5dddd1e6f975f0b5c516cdff28b';

async function checkCorrectVersionRunning(url: string): Promise<boolean> {
	try {
		// console.log('Version check starting');
		const response = await fetch(`${url}/api/version`);
		// console.log('Version check done' + response);
		const version = await response.json();
		// console.log('version content');
		// console.log(version);
		return version.version_hash === SIDECAR_VERSION;
	} catch (e) {
		return false;
	}
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

async function checkServerRunning(serverUrl: string): Promise<boolean> {
	try {
		// console.log('Health check starting');
		const response = await fetch(`${serverUrl}/api/health`);
		if (response.status === 200) {
			// console.log('Sidecar server already running');
			// console.log('Health check done');
			return true;
		} else {
			// console.log('Health check done');
			return false;
		}
	} catch (e) {
		return false;
	}
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

async function checkOrKillRunningServer(serverUrl: string): Promise<boolean> {
	const serverRunning = await checkServerRunning(serverUrl);
	if (serverRunning) {
		// console.log('Killing previous sidecar server');
		try {
			await killSidecarProcess();
		} catch (e: any) {
			if (!e.message.includes('Process doesn\'t exist')) {
				// console.log('Failed to kill old server:', e);
			}
		}
	}
	return false;
}

export async function startSidecarBinaryWithLocal(
	installLocation: string,
): Promise<boolean> {
	// Fixing the variable name here from sserverUrl -> serverUrl
	// should be automatig, or can we really do it with lsp
	const serverUrl = getSidecarBinaryURL();
	const shouldUseSelfRun = sidecarUseSelfRun();
	if (shouldUseSelfRun) {
		return true;
	}
	// check here if the binary is downloaded locally and if thats the case
	// try to run it from there
	const sidecarBinPath = path.join(installLocation, 'extensions', 'codestory', 'sidecar_bin');
	// console.log('startSidecarBinaryWithLocation', sidecarBinPath);
	if (fs.existsSync(sidecarBinPath)) {
		const sidecarBinPathExists = fs.existsSync(path.join(sidecarBinPath, 'sidecar'));
		if (sidecarBinPathExists) {
			try {
				// console.log('Starting sidecar binary locally', sidecarBinPath, serverUrl);
				const sidecarValue = await runSideCarBinary(sidecarBinPath, serverUrl);
				// console.log('Sidecar binary exists locally, running it', sidecarValue);
				return sidecarValue;
			} catch (e) {
				return false;
				// console.log('Failed to run sidecar binary locally', e);
			}
		}
	}

	return false;
}


export async function startSidecarBinary(
	extensionBasePath: string,
	installLocation: string,
): Promise<string> {
	const sidecarServerUrl = 'http://127.0.0.1:42424';
	// Check if we are running the correct version, or else we download a new version
	if (!await checkCorrectVersionRunning(sidecarServerUrl)) {
		console.log('correct version of sidecar is not running, killing the server');
		await checkOrKillRunningServer(sidecarServerUrl);
	}
	// if the correct version is already running, then just return it
	if (await checkCorrectVersionRunning(sidecarServerUrl)) {
		return sidecarServerUrl;
	}
	console.log('starting sidecar binary locally');
	// We want to check where the sidecar binary is stored
	// extension_path: /Users/skcd/.vscode-oss-dev/User/globalStorage/codestory-ghost.codestoryai/sidecar_bin
	// installation location: /Users/skcd/Downloads/Aide.app/Contents/Resources/app/extensions/codestory/sidecar_bin
	// we have to figure out how to copy them together
	// console.log('starting sidecar binary');
	// console.log('installLocation', installLocation);
	const selfStart = await startSidecarBinaryWithLocal(installLocation);
	if (selfStart) {
		return 'http://127.0.0.1:42424';
	}
	// Check vscode settings
	const serverUrl = getSidecarBinaryURL();
	const shouldUseSelfRun = sidecarUseSelfRun();
	if (shouldUseSelfRun) {
		return serverUrl;
	}

	// Check if we are running the correct version, or else we download a new version
	if (await checkCorrectVersionRunning(serverUrl)) {
		// console.log('Correct version of Sidecar binary is running');
		return 'http://127.0.0.1:42424';
	}

	// First let's kill the running version
	// console.log('Killing running Sidecar binary');
	await checkOrKillRunningServer(serverUrl);

	// console.log('Starting Sidecar binary right now');

	// Download the server executable
	const bucket = 'sidecar-bin';
	const fileName =
		os.platform() === 'win32'
			? 'windows/sidecar.zip'
			: os.platform() === 'darwin'
				? 'mac/sidecar.zip'
				: 'linux/sidecar.zip';

	const zipDestination = path.join(
		extensionBasePath,
		'sidecar_zip.zip',
	);
	const sidecarDestination = path.join(
		extensionBasePath,
		'sidecar_bin',
	);

	// First, check if the server is already downloaded
	// console.log('Downloading the sidecar binary...');
	await window.withProgress(
		{
			location: ProgressLocation.SourceControl,
			// allow-any-unicode-next-line
			title: 'Downloading the sidecar binary 🦀',
			cancellable: false,
		},
		async () => {
			try {
				await downloadFromGCPBucket(bucket, fileName, zipDestination);
			} catch (e) {
				// console.log('Failed to download from GCP bucket, trying using URL: ', e);
				await downloadUsingURL(bucket, fileName, zipDestination);
			}
		}
	);

	// console.log(`Downloaded sidecar zip at ${zipDestination}`);
	// Now we need to unzip the folder in the location and also run a few commands
	// for the dylib files and the binary
	// -o is important here because we want to override the downloaded binary
	// if it has been already downloaded
	// console.log(zipDestination);
	// console.log(sidecarDestination);
	// hopefully this works as we want it to
	unzipSidecarZipFolder(zipDestination, sidecarDestination);
	// now delete the zip file
	fs.unlinkSync(zipDestination);
	// Get name of the corresponding executable for platform
	await runSideCarBinary(sidecarDestination, serverUrl);
	return 'http://127.0.0.1:42424';
}

export function killSidecarProcess(): Promise<void> {
	return killProcessOnPort(42424);
}

async function runSideCarBinary(sidecarDestination: string, serverUrl: string) {
	let webserverPath = null;
	if (os.platform() === 'win32') {
		webserverPath = path.join(sidecarDestination, 'target', 'release', 'webserver.exe');
	} else {
		webserverPath = path.join(sidecarDestination, 'target', 'release', 'webserver');
	}

	if (os.platform() === 'darwin' || os.platform() === 'linux') {
		// Now we want to change the permissions for the following files:
		// target/release/webserver
		fs.chmodSync(webserverPath, 0o7_5_5);
	}

	if (os.platform() === 'darwin') {
		// We need to run this command on the darwin platform
		await runCommand(`xattr -dr com.apple.quarantine ${webserverPath}`);
	}


	// Validate that the file exists
	if (!fs.existsSync(webserverPath)) {
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

			let sidecarBinary = '';
			if (os.platform() === 'win32') {
				sidecarBinary = path.join(sidecarDestination, 'target', 'release', 'webserver.exe');
			} else {
				sidecarBinary = path.join(sidecarDestination, 'target', 'release', 'webserver');
			}
			// console.log('what are the args');
			// console.log(args, sidecarBinary);
			const child = spawn(sidecarBinary, settings);

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
