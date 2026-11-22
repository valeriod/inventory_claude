import { writeFakeCamera } from './fake-camera.ts';

export default function globalSetup(): void {
	writeFakeCamera();
}
