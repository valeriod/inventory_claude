<script lang="ts">
	import { onMount } from 'svelte';
	import { createScanEngine, type Detection, type ScanEngine } from '#lib/scanner/engine.js';
	import { normalizeScan } from '#lib/scanner/formats.js';

	let {
		onscan,
		paused = false,
		/** Ignore the same code for this long, so holding a label in view does not repeat it. */
		repeatDelay = 2500
	}: {
		onscan: (detection: Detection) => void;
		paused?: boolean;
		repeatDelay?: number;
	} = $props();

	type Status = 'starting' | 'running' | 'error';

	let video = $state<HTMLVideoElement>();
	let status = $state<Status>('starting');
	let errorMessage = $state('');
	let engineName = $state('');
	let torchAvailable = $state(false);
	let torchOn = $state(false);
	let cameras = $state<MediaDeviceInfo[]>([]);
	let cameraIndex = $state(-1);
	let flash = $state(false);

	let stream: MediaStream | null = null;
	let engine: ScanEngine | null = null;
	let running = false;
	let last = { text: '', at: 0 };
	let audio: AudioContext | null = null;

	function cameraError(err: unknown): string {
		const name = err instanceof DOMException ? err.name : '';
		if (name === 'NotAllowedError' || name === 'SecurityError')
			return 'Camera access was denied. Allow camera access for this site in your browser settings, then try again.';
		if (name === 'NotFoundError' || name === 'OverconstrainedError')
			return 'No camera was found on this device.';
		if (name === 'NotReadableError')
			return 'The camera is in use by another app. Close it and try again.';
		return `Could not start the camera${err instanceof Error ? `: ${err.message}` : ''}.`;
	}

	async function startCamera(deviceId?: string) {
		stopCamera();
		status = 'starting';
		if (!navigator.mediaDevices?.getUserMedia) {
			status = 'error';
			errorMessage = window.isSecureContext
				? 'This browser cannot access the camera.'
				: 'The camera only works over HTTPS. Open the app through its https:// address.';
			return;
		}
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: deviceId
					? { deviceId: { exact: deviceId } }
					: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
			});
		} catch (err) {
			status = 'error';
			errorMessage = cameraError(err);
			return;
		}
		if (!video) return;
		video.srcObject = stream;
		await video.play().catch(() => {});

		const track = stream.getVideoTracks()[0];
		const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
		torchAvailable = caps.torch === true;
		torchOn = false;

		// Device labels are only available after permission is granted.
		const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
		cameras = devices.filter((d) => d.kind === 'videoinput');
		const activeId = track?.getSettings().deviceId;
		cameraIndex = cameras.findIndex((c) => c.deviceId === activeId);

		engine ??= await createScanEngine();
		engineName = engine.name;
		status = 'running';
		void loop();
	}

	function stopCamera() {
		running = false;
		for (const track of stream?.getTracks() ?? []) track.stop();
		stream = null;
		if (video) video.srcObject = null;
	}

	async function loop() {
		if (running) return;
		running = true;
		while (running) {
			if (!paused && engine && video && video.readyState >= 2) {
				try {
					const found = await engine.detect(video);
					if (running && !paused) handle(found);
				} catch {
					// A single bad frame is not worth surfacing; keep scanning.
				}
			}
			await new Promise((r) => setTimeout(r, engine?.name === 'native' ? 80 : 120));
		}
	}

	function handle(found: Detection[]) {
		const now = Date.now();
		for (const d of found) {
			const text = normalizeScan(d.text);
			if (!text) continue;
			if (text === last.text && now - last.at < repeatDelay) {
				last.at = now;
				continue;
			}
			last = { text, at: now };
			feedback();
			onscan({ text, format: d.format });
			return;
		}
	}

	function feedback() {
		navigator.vibrate?.(60);
		flash = true;
		setTimeout(() => (flash = false), 250);
		try {
			audio ??= new AudioContext();
			if (audio.state !== 'running') return;
			const osc = audio.createOscillator();
			const gain = audio.createGain();
			osc.frequency.value = 1800;
			gain.gain.value = 0.08;
			osc.connect(gain).connect(audio.destination);
			osc.start();
			osc.stop(audio.currentTime + 0.08);
		} catch {
			// No audio; vibration and the flash are enough.
		}
	}

	// While paused (e.g. a dialog is open) the code in view is not being seen, so its repeat
	// timer would expire; restart it on resume so a label still in view does not fire again.
	$effect(() => {
		if (!paused) last.at = Date.now();
	});

	async function toggleTorch() {
		const track = stream?.getVideoTracks()[0];
		if (!track) return;
		try {
			await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
			torchOn = !torchOn;
		} catch {
			torchAvailable = false;
		}
	}

	function switchCamera() {
		if (cameras.length < 2) return;
		const next = cameras[(cameraIndex + 1) % cameras.length]!;
		void startCamera(next.deviceId);
	}

	/** Browsers only start audio after a user gesture; unlock the beep on the first tap. */
	function unlockAudio() {
		try {
			audio ??= new AudioContext();
			void audio.resume();
		} catch {
			// ignore
		}
	}

	onMount(() => {
		void startCamera();
		// Release the camera while the app is in the background, and resume when it returns.
		const onVisibility = () => {
			if (document.hidden) stopCamera();
			else if (!stream) void startCamera(cameras[cameraIndex]?.deviceId);
		};
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pointerdown', unlockAudio, { once: true });
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pointerdown', unlockAudio);
			stopCamera();
			engine?.dispose();
			engine = null;
			void audio?.close();
		};
	});
</script>

<div
	class="relative overflow-hidden rounded-lg bg-black"
	data-testid="scanner"
	data-status={status}
	data-engine={engineName}
>
	<video
		bind:this={video}
		class="aspect-[4/3] max-h-[55dvh] w-full object-cover"
		playsinline
		muted
		autoplay
	></video>

	{#if status === 'running'}
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
			<div
				class="aspect-square w-3/5 max-w-72 rounded-xl border-4 transition-colors"
				class:border-white={!flash}
				class:border-green-400={flash}
				class:opacity-40={paused}
			></div>
		</div>
		<div
			class="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/50 p-2 text-xs text-white"
		>
			<span>{paused ? 'Paused' : 'Point the camera at a barcode or QR code'}</span>
			<span class="ml-auto opacity-60">{engineName === 'native' ? 'built-in' : 'zxing'}</span>
			{#if cameras.length > 1}
				<button type="button" class="rounded bg-white/20 px-2 py-1" onclick={switchCamera}>
					Switch camera
				</button>
			{/if}
			{#if torchAvailable}
				<button
					type="button"
					class="rounded px-2 py-1 {torchOn ? 'bg-white text-black' : 'bg-white/20'}"
					aria-pressed={torchOn}
					onclick={toggleTorch}
				>
					Light
				</button>
			{/if}
		</div>
	{:else if status === 'starting'}
		<p class="absolute inset-0 flex items-center justify-center text-sm text-white/80">
			Starting camera…
		</p>
	{:else}
		<div class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
			<p class="text-sm text-white" role="alert">{errorMessage}</p>
			<button type="button" class="btn btn-sm" onclick={() => startCamera()}>Try again</button>
		</div>
	{/if}
</div>
