import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { MeetingsRepository } from 'src/meeting/meetings.repository';

export type PlanId = 'free' | 'pro' | 'enterprise';

export interface Plan {
  id: PlanId;
  name: string;
  /** Meetings a user may host per cycle. null means unlimited. */
  meetingLimit: number | null;
  blurb: string;
  highlights: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    meetingLimit: 5,
    blurb: 'Get started and host your first meetings.',
    highlights: [
      '5 hosted meetings',
      'Up to 60 minutes per meeting',
      'HD video and screen share',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    meetingLimit: null,
    blurb: 'Unlimited meetings for everyday collaboration.',
    highlights: [
      'Unlimited hosted meetings',
      'Up to 24 hours per meeting',
      'Recording and live captions',
      'Priority support',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    meetingLimit: null,
    blurb: 'For teams that need control and scale.',
    highlights: [
      'Everything in Pro',
      'Admin controls and SSO',
      'Usage analytics',
      'Dedicated account manager',
    ],
  },
};

export interface MeetingUsage {
  plan: Plan;
  used: number;
  limit: number | null;
  remaining: number | null;
  exhausted: boolean;
  /**
   * False while no meeting-history table exists — the counts below are the
   * starting values, not observed usage. The profile page says so rather than
   * presenting a zero as if it had been measured.
   */
  usageTracked: boolean;
}

/**
 * Plan and quota for a user, read from dbo.vw_infymeet_user_usage.
 *
 * The view is the single source of truth: it counts hosted meetings live from
 * infymeet_meetings rather than trusting a stored counter, so the number can
 * never drift away from what actually happened.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly meetings: MeetingsRepository,
  ) {}

  async getUsage(userId: number): Promise<MeetingUsage> {
    const row = await this.meetings.getUsage(userId);

    // No row means the view could not be read (or the user has no active plan
    // yet). Fall back to the free defaults rather than failing the profile
    // page, and say the numbers are not measured.
    if (!row) {
      const plan = PLANS.free;
      return {
        plan,
        used: 0,
        limit: plan.meetingLimit,
        remaining: plan.meetingLimit,
        exhausted: false,
        usageTracked: false,
      };
    }

    const plan = this.planFor(row.PlanID, row.MeetingLimit);
    const used = Number(row.MeetingsUsed ?? 0);
    const limit = row.MeetingLimit === null ? null : Number(row.MeetingLimit);

    return {
      plan,
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
      exhausted: limit !== null && used >= limit,
      usageTracked: true,
    };
  }

  /**
   * Map a stored plan id onto a known plan.
   *
   * The row's own MeetingLimit wins over the catalogue default, so a bespoke
   * allowance set directly in the subscriptions table is honoured.
   */
  private planFor(planId: string | null, limit: number | null): Plan {
    const base = PLANS[(planId ?? 'free') as PlanId] ?? PLANS.free;
    if (limit === null || limit === undefined) return base;
    return { ...base, meetingLimit: Number(limit) };
  }

  /** A host's recent meetings, for the profile dashboard. */
  async listMeetings(userId: number, limit = 10) {
    return this.meetings.listForHost(userId, limit);
  }

  /** Every plan, for the upgrade panel. */
  listPlans(): Plan[] {
    return [PLANS.free, PLANS.pro, PLANS.enterprise];
  }
}
