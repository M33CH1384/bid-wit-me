import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { MANSION } from './mansionLayout';
export function preloadMansionRoom(): void { preloadCubeVenue(MANSION); }
export default function MansionRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={MANSION} quality={quality} handNo={handNo} />;
}
