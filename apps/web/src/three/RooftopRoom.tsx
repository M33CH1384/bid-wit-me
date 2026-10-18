import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { ROOFTOP } from './rooftopLayout';
export function preloadRooftopRoom(): void { preloadCubeVenue(ROOFTOP); }
export default function RooftopRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={ROOFTOP} quality={quality} handNo={handNo} />;
}
