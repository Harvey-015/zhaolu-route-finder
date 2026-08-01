import type { RouteScoringPolicy } from "./ports.ts";
import type {
  CandidateGenerationStrategy,
  RouteSelectionStrategy,
} from "./strategies.ts";

export type RecommendationAlgorithmProfile = Readonly<{
  id: string;
  version: string;
  displayName: string;
  candidateGenerationStrategy: CandidateGenerationStrategy;
  scoringPolicy: RouteScoringPolicy;
  routeSelectionStrategy: RouteSelectionStrategy;
}>;

const ALGORITHM_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function defineRecommendationAlgorithm(
  profile: RecommendationAlgorithmProfile,
): RecommendationAlgorithmProfile {
  if (!ALGORITHM_ID_PATTERN.test(profile.id)) {
    throw new TypeError("RECOMMENDATION_ALGORITHM_ID_INVALID");
  }
  if (!VERSION_PATTERN.test(profile.version)) {
    throw new TypeError("RECOMMENDATION_ALGORITHM_VERSION_INVALID");
  }
  if (!profile.displayName.trim()) {
    throw new TypeError("RECOMMENDATION_ALGORITHM_NAME_REQUIRED");
  }
  if (typeof profile.candidateGenerationStrategy !== "function") {
    throw new TypeError("CANDIDATE_GENERATION_STRATEGY_REQUIRED");
  }
  if (typeof profile.scoringPolicy.score !== "function") {
    throw new TypeError("ROUTE_SCORING_POLICY_REQUIRED");
  }
  if (typeof profile.routeSelectionStrategy !== "function") {
    throw new TypeError("ROUTE_SELECTION_STRATEGY_REQUIRED");
  }
  return Object.freeze({ ...profile });
}

export class RecommendationAlgorithmRegistry {
  private readonly registered: ReadonlyMap<
    string,
    RecommendationAlgorithmProfile
  >;

  constructor(profiles: readonly RecommendationAlgorithmProfile[]) {
    const registered = new Map<
      string,
      RecommendationAlgorithmProfile
    >();
    for (const profile of profiles) {
      const normalized = defineRecommendationAlgorithm(profile);
      const key = RecommendationAlgorithmRegistry.key(
        normalized.id,
        normalized.version,
      );
      if (registered.has(key)) {
        throw new TypeError("RECOMMENDATION_ALGORITHM_DUPLICATE");
      }
      registered.set(key, normalized);
    }
    this.registered = registered;
  }

  static key(id: string, version: string): string {
    return `${id}@${version}`;
  }

  get(
    id: string,
    version: string,
  ): RecommendationAlgorithmProfile | undefined {
    return this.registered.get(
      RecommendationAlgorithmRegistry.key(id, version),
    );
  }

  require(
    id: string,
    version: string,
  ): RecommendationAlgorithmProfile {
    const profile = this.get(id, version);
    if (!profile) {
      throw new Error("RECOMMENDATION_ALGORITHM_NOT_REGISTERED");
    }
    return profile;
  }

  ids(): readonly string[] {
    return [...this.registered.keys()];
  }
}
