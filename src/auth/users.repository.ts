import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto';
import { DatabaseService } from 'src/database/database.service';
import { mobileKey } from './contact.policy';

/** A row of dbo.infymeet_users as the rest of the app consumes it. */
export interface InfymeetUser {
  UserID: number;
  FullName: string | null;
  Email: string | null;
  Mobile: string | null;
  AuthProvider: string | null;
  GoogleID: string | null;
  Role: string | null;
  IsActive: boolean | null;
  EmailVerified: boolean | null;
  MobileVerified: boolean | null;
  CreatedDate: Date | null;
  LastLoginDate: Date | null;
  AvatarUrl: string | null;
}

/** The columns every read returns. PasswordHash is never in this list. */
const USER_COLUMNS = `
  UserID, FullName, Email, Mobile, AuthProvider, GoogleID, Role,
  IsActive, EmailVerified, MobileVerified, CreatedDate, LastLoginDate
`;

@Injectable()
export class UsersRepository {
  private readonly logger = new Logger(UsersRepository.name);

  /** Resolved once per process: does dbo.infymeet_users carry AvatarUrl yet? */
  private avatarColumn: Promise<boolean> | null = null;

  constructor(private readonly db: DatabaseService) {}

  /**
   * Add the avatar column if this database has not got it yet.
   *
   * Doing it here rather than in a migration script means a freshly pulled
   * build behaves the same on a developer machine and on the live server. If
   * the login has no rights to alter the table, reads fall back to a NULL
   * avatar instead of failing — the rest of the account still works.
   */
  private ensureAvatarColumn(): Promise<boolean> {
    if (!this.avatarColumn) {
      this.avatarColumn = this.db
        .query<{ Present: number }>(
          `IF COL_LENGTH('dbo.infymeet_users', 'AvatarUrl') IS NULL
             ALTER TABLE dbo.infymeet_users ADD AvatarUrl NVARCHAR(MAX) NULL;
           SELECT CASE WHEN COL_LENGTH('dbo.infymeet_users', 'AvatarUrl') IS NULL
                       THEN 0 ELSE 1 END AS Present;`,
        )
        .then((rows) => Number(rows[0]?.Present ?? 0) === 1)
        .catch((err) => {
          this.logger.warn(`Avatar column unavailable, profile photos disabled: ${err}`);
          return false;
        });
    }
    return this.avatarColumn;
  }

  /** The read column list, with AvatarUrl only when the database has it. */
  private async columns(): Promise<string> {
    const present = await this.ensureAvatarColumn();
    return `${USER_COLUMNS}, ${present ? 'AvatarUrl' : "CAST(NULL AS NVARCHAR(MAX)) AS AvatarUrl"}`;
  }

  // ── Password hashing ────────────────────────────────────────────────
  //
  // Stored as `scrypt$<salt-hex>$<hash-hex>`. Rows written before this used a
  // bare unsalted SHA-256 hex digest, so verification still accepts that shape
  // and the caller re-writes the row in the new format on a successful login.

  hashPassword(password: string): string {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
  }

  /** True when `password` matches `stored`, whichever format it is in. */
  verifyPassword(password: string, stored: string | null): boolean {
    if (!stored) return false;

    if (stored.startsWith('scrypt$')) {
      const [, saltHex, hashHex] = stored.split('$');
      if (!saltHex || !hashHex) return false;
      try {
        const expected = Buffer.from(hashHex, 'hex');
        const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
        return timingSafeEqual(expected, actual);
      } catch {
        return false;
      }
    }

    // Legacy unsalted SHA-256.
    const legacy = createHash('sha256').update(password).digest('hex');
    return legacy.length === stored.length &&
      timingSafeEqual(Buffer.from(legacy), Buffer.from(stored));
  }

  /** True when the stored hash still uses the old unsalted format. */
  isLegacyHash(stored: string | null): boolean {
    return !!stored && !stored.startsWith('scrypt$');
  }

  // ── Reads ───────────────────────────────────────────────────────────

  async findByEmail(email: string): Promise<InfymeetUser | null> {
    const rows = await this.db.query<InfymeetUser>(
      `SELECT TOP 1 ${await this.columns()}
       FROM dbo.infymeet_users
       WHERE Email = CAST(@Email AS NVARCHAR(200)) AND ISNULL(IsDeleted, 0) = 0`,
      { Email: email },
    );
    return rows[0] ?? null;
  }

  /**
   * Find an account by mobile, comparing only the last ten digits.
   *
   * Rows written before the country selector existed hold a bare national
   * number while new ones carry the country code, and the OTP store already
   * keys on the last ten — matching on that makes every format resolve to the
   * same account instead of silently missing.
   */
  async findByMobile(mobile: string): Promise<InfymeetUser | null> {
    const key = mobileKey(mobile);
    if (!key) return null;

    const rows = await this.db.query<InfymeetUser>(
      `SELECT TOP 1 ${await this.columns()}
       FROM dbo.infymeet_users
       WHERE ISNULL(IsDeleted, 0) = 0
         AND Mobile IS NOT NULL
         AND RIGHT(REPLACE(REPLACE(Mobile, '+', ''), ' ', ''), 10)
             = CAST(@MobileKey AS NVARCHAR(10))
       ORDER BY UserID DESC`,
      { MobileKey: key },
    );
    return rows[0] ?? null;
  }

  /**
   * Which of these two contacts already belong to an account.
   *
   * Both are checked because either one being taken blocks the signup — an
   * email and a phone number may each front exactly one account.
   */
  async findConflicts(
    email: string,
    mobile: string,
  ): Promise<{ emailTaken: boolean; mobileTaken: boolean }> {
    const key = mobileKey(mobile);

    const rows = await this.db.query<{ EmailTaken: number; MobileTaken: number }>(
      `SELECT
         MAX(CASE WHEN @Email <> '' AND Email = CAST(@Email AS NVARCHAR(200))
                  THEN 1 ELSE 0 END) AS EmailTaken,
         MAX(CASE WHEN @MobileKey <> '' AND Mobile IS NOT NULL
                   AND RIGHT(REPLACE(REPLACE(Mobile, '+', ''), ' ', ''), 10)
                       = CAST(@MobileKey AS NVARCHAR(10))
                  THEN 1 ELSE 0 END) AS MobileTaken
       FROM dbo.infymeet_users
       WHERE ISNULL(IsDeleted, 0) = 0`,
      { Email: (email ?? '').trim(), MobileKey: key },
    );

    const row = rows[0];
    return {
      emailTaken: Number(row?.EmailTaken ?? 0) === 1,
      mobileTaken: Number(row?.MobileTaken ?? 0) === 1,
    };
  }

  async findById(userId: number): Promise<InfymeetUser | null> {
    const rows = await this.db.query<InfymeetUser>(
      `SELECT TOP 1 ${await this.columns()}
       FROM dbo.infymeet_users
       WHERE UserID = CAST(@UserID AS BIGINT) AND ISNULL(IsDeleted, 0) = 0`,
      { UserID: userId },
    );
    return rows[0] ?? null;
  }

  private async findCredentials(
    email: string,
  ): Promise<{ UserID: number; PasswordHash: string | null; IsActive: boolean | null } | null> {
    const rows = await this.db.query<{
      UserID: number;
      PasswordHash: string | null;
      IsActive: boolean | null;
    }>(
      `SELECT TOP 1 UserID, PasswordHash, IsActive
       FROM dbo.infymeet_users
       WHERE Email = CAST(@Email AS NVARCHAR(200)) AND ISNULL(IsDeleted, 0) = 0`,
      { Email: email },
    );
    return rows[0] ?? null;
  }

  // ── Writes ──────────────────────────────────────────────────────────

  /**
   * Find-or-create the account behind a Google profile, then stamp the login.
   *
   * The match prefers GoogleID and falls back to Email, which is what links a
   * Google sign-in to an account that was originally created with a password —
   * inserting instead would trip the table's UNIQUE constraint on Email.
   */
  async upsertGoogleUser(profile: {
    googleId: string;
    email?: string | null;
    fullName?: string | null;
  }): Promise<InfymeetUser | null> {
    const rows = await this.db.query<InfymeetUser>(
      `
      DECLARE @UserID BIGINT;

      SELECT TOP 1 @UserID = UserID
      FROM dbo.infymeet_users
      WHERE ISNULL(IsDeleted, 0) = 0
        AND (
          (@GoogleID IS NOT NULL AND GoogleID = CAST(@GoogleID AS NVARCHAR(300)))
          OR (@Email IS NOT NULL AND Email = CAST(@Email AS NVARCHAR(200)))
        )
      ORDER BY CASE WHEN GoogleID = CAST(@GoogleID AS NVARCHAR(300)) THEN 0 ELSE 1 END, UserID;

      IF @UserID IS NULL
      BEGIN
        INSERT INTO dbo.infymeet_users
          (FullName, Email, GoogleID, AuthProvider, IsActive, CreatedDate,
           LastLoginDate, EmailVerified, MobileVerified, Role, IsDeleted)
        VALUES
          (@FullName, @Email, @GoogleID, 'google', 1, GETDATE(),
           GETDATE(), 1, 0, 'user', 0);
        SET @UserID = SCOPE_IDENTITY();
      END
      ELSE
      BEGIN
        UPDATE dbo.infymeet_users
        SET FullName      = COALESCE(NULLIF(@FullName, ''), FullName),
            GoogleID      = COALESCE(@GoogleID, GoogleID),
            AuthProvider  = CASE
                              WHEN AuthProvider IS NULL OR AuthProvider = ''
                              THEN 'google' ELSE AuthProvider
                            END,
            EmailVerified = 1,
            IsActive      = 1,
            LastLoginDate = GETDATE()
        WHERE UserID = @UserID;
      END

      SELECT ${await this.columns()} FROM dbo.infymeet_users WHERE UserID = @UserID;
      `,
      {
        GoogleID: profile.googleId,
        Email: profile.email ?? null,
        FullName: profile.fullName ?? null,
      },
    );
    return rows[0] ?? null;
  }

  /**
   * Create a password account. Returns null when the email is already taken,
   * so the caller can report that instead of surfacing a constraint violation.
   */
  async createLocalUser(input: {
    fullName: string;
    email: string;
    mobile?: string | null;
    password: string;
  }): Promise<InfymeetUser | null> {
    const rows = await this.db.query<InfymeetUser>(
      `
      IF EXISTS (
        SELECT 1 FROM dbo.infymeet_users
        WHERE ISNULL(IsDeleted, 0) = 0
          AND (
            Email = CAST(@Email AS NVARCHAR(200))
            OR (
              @MobileKey <> '' AND Mobile IS NOT NULL
              AND RIGHT(REPLACE(REPLACE(Mobile, '+', ''), ' ', ''), 10)
                  = CAST(@MobileKey AS NVARCHAR(10))
            )
          )
      )
      BEGIN
        SELECT TOP 0 ${await this.columns()} FROM dbo.infymeet_users;
      END
      ELSE
      BEGIN
        DECLARE @NewID BIGINT;
        INSERT INTO dbo.infymeet_users
          (FullName, Email, Mobile, PasswordHash, AuthProvider, IsActive,
           CreatedDate, LastLoginDate, EmailVerified, MobileVerified, Role, IsDeleted)
        VALUES
          (@FullName, @Email, @Mobile, @PasswordHash, 'local', 1,
           GETDATE(), GETDATE(), 0, 1, 'user', 0);
        SET @NewID = SCOPE_IDENTITY();
        SELECT ${await this.columns()} FROM dbo.infymeet_users WHERE UserID = @NewID;
      END
      `,
      {
        FullName: input.fullName,
        Email: input.email,
        Mobile: input.mobile ?? null,
        MobileKey: mobileKey(input.mobile ?? ''),
        PasswordHash: this.hashPassword(input.password),
      },
    );
    return rows[0] ?? null;
  }

  /** Verify an email/password pair. Returns the user, or null on any mismatch. */
  async verifyLocalLogin(email: string, password: string): Promise<InfymeetUser | null> {
    const creds = await this.findCredentials(email);
    if (!creds || !creds.PasswordHash) return null;
    if (creds.IsActive === false) return null;
    if (!this.verifyPassword(password, creds.PasswordHash)) return null;

    // Quietly move legacy rows onto the salted format now that we hold the
    // plaintext and know it is correct.
    if (this.isLegacyHash(creds.PasswordHash)) {
      await this.db
        .query(
          `UPDATE dbo.infymeet_users SET PasswordHash = @PasswordHash WHERE UserID = @UserID`,
          { PasswordHash: this.hashPassword(password), UserID: creds.UserID },
        )
        .catch((err) => this.logger.warn(`Could not upgrade password hash: ${err}`));
    }

    await this.touchLogin(creds.UserID);
    return this.findById(creds.UserID);
  }

  /**
   * What a reset request needs to know: where to send the code, and whether
   * this account has a password to reset at all.
   *
   * Uses no columns beyond the ones already in dbo.infymeet_users — a reset
   * code lives in memory for ten minutes, so there is no token table to add.
   */
  async findResetTarget(email: string): Promise<{
    userId: number;
    mobile: string | null;
    fullName: string | null;
    authProvider: string | null;
    hasPassword: boolean;
    isActive: boolean;
  } | null> {
    const rows = await this.db.query<{
      UserID: number;
      Mobile: string | null;
      FullName: string | null;
      AuthProvider: string | null;
      HasPassword: number;
      IsActive: boolean | null;
    }>(
      `SELECT TOP 1
         UserID,
         Mobile,
         FullName,
         AuthProvider,
         CASE WHEN PasswordHash IS NULL OR LEN(PasswordHash) = 0
              THEN 0 ELSE 1 END AS HasPassword,
         IsActive
       FROM dbo.infymeet_users
       WHERE Email = CAST(@Email AS NVARCHAR(200)) AND ISNULL(IsDeleted, 0) = 0`,
      { Email: email },
    );

    const row = rows[0];
    if (!row) return null;

    return {
      userId: Number(row.UserID),
      mobile: row.Mobile,
      fullName: row.FullName,
      authProvider: row.AuthProvider,
      hasPassword: Number(row.HasPassword) === 1,
      isActive: row.IsActive !== false,
    };
  }

  /** Overwrite the stored password. The caller must have verified the reset code. */
  async updatePassword(userId: number, newPassword: string): Promise<InfymeetUser | null> {
    await this.db.query(
      `UPDATE dbo.infymeet_users
       SET PasswordHash = @PasswordHash,
           LastLoginDate = GETDATE()
       WHERE UserID = CAST(@UserID AS BIGINT) AND ISNULL(IsDeleted, 0) = 0`,
      { PasswordHash: this.hashPassword(newPassword), UserID: userId },
    );
    return this.findById(userId);
  }

  /** Record a mobile that has just passed OTP verification. */
  async setVerifiedMobile(userId: number, mobile: string): Promise<InfymeetUser | null> {
    await this.db.query(
      `UPDATE dbo.infymeet_users
       SET Mobile = CAST(@Mobile AS NVARCHAR(20)),
           MobileVerified = 1,
           LastLoginDate = GETDATE()
       WHERE UserID = CAST(@UserID AS BIGINT) AND ISNULL(IsDeleted, 0) = 0`,
      { Mobile: mobile, UserID: userId },
    );
    return this.findById(userId);
  }

  /**
   * Store (or clear, with null) the user's profile photo.
   *
   * Returns null when this database has no avatar column, so the caller can
   * tell "not saved" apart from "saved nothing".
   */
  async setAvatar(userId: number, avatarUrl: string | null): Promise<InfymeetUser | null> {
    if (!(await this.ensureAvatarColumn())) return null;

    await this.db.query(
      `UPDATE dbo.infymeet_users
       SET AvatarUrl = @AvatarUrl
       WHERE UserID = CAST(@UserID AS BIGINT) AND ISNULL(IsDeleted, 0) = 0`,
      { AvatarUrl: avatarUrl, UserID: userId },
    );
    return this.findById(userId);
  }

  async touchLogin(userId: number): Promise<void> {
    await this.db
      .query(`UPDATE dbo.infymeet_users SET LastLoginDate = GETDATE() WHERE UserID = @UserID`, {
        UserID: userId,
      })
      .catch((err) => this.logger.warn(`Could not stamp LastLoginDate: ${err}`));
  }

  /** The shape handed to the frontend and embedded in the JWT. */
  toPublic(user: InfymeetUser) {
    return {
      userId: Number(user.UserID),
      fullName: user.FullName ?? '',
      email: user.Email ?? '',
      mobile: user.Mobile ?? '',
      role: user.Role ?? 'user',
      authProvider: user.AuthProvider ?? 'local',
      emailVerified: !!user.EmailVerified,
      avatarUrl: user.AvatarUrl ?? '',
    };
  }
}
