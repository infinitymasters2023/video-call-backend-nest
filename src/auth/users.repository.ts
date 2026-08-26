import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto';
import { DatabaseService } from 'src/database/database.service';

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
}

/** The columns every read returns. PasswordHash is never in this list. */
const USER_COLUMNS = `
  UserID, FullName, Email, Mobile, AuthProvider, GoogleID, Role,
  IsActive, EmailVerified, MobileVerified, CreatedDate, LastLoginDate
`;

@Injectable()
export class UsersRepository {
  private readonly logger = new Logger(UsersRepository.name);

  constructor(private readonly db: DatabaseService) {}

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
      `SELECT TOP 1 ${USER_COLUMNS}
       FROM dbo.infymeet_users
       WHERE Email = CAST(@Email AS NVARCHAR(200)) AND ISNULL(IsDeleted, 0) = 0`,
      { Email: email },
    );
    return rows[0] ?? null;
  }

  async findByMobile(mobile: string): Promise<InfymeetUser | null> {
    const rows = await this.db.query<InfymeetUser>(
      `SELECT TOP 1 ${USER_COLUMNS}
       FROM dbo.infymeet_users
       WHERE Mobile = CAST(@Mobile AS NVARCHAR(20)) AND ISNULL(IsDeleted, 0) = 0
       ORDER BY UserID DESC`,
      { Mobile: mobile },
    );
    return rows[0] ?? null;
  }

  async findById(userId: number): Promise<InfymeetUser | null> {
    const rows = await this.db.query<InfymeetUser>(
      `SELECT TOP 1 ${USER_COLUMNS}
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

      SELECT ${USER_COLUMNS} FROM dbo.infymeet_users WHERE UserID = @UserID;
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
        WHERE Email = CAST(@Email AS NVARCHAR(200)) AND ISNULL(IsDeleted, 0) = 0
      )
      BEGIN
        SELECT TOP 0 ${USER_COLUMNS} FROM dbo.infymeet_users;
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
        SELECT ${USER_COLUMNS} FROM dbo.infymeet_users WHERE UserID = @NewID;
      END
      `,
      {
        FullName: input.fullName,
        Email: input.email,
        Mobile: input.mobile ?? null,
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
    };
  }
}
