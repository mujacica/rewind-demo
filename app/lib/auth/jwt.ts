/**
 * JWT Service
 * Handles JSON Web Token creation, verification, and management
 */

import jwt from 'jsonwebtoken';

// Types for JWT operations
export interface DecodedToken {
  userId: string;
  email: string;
  role: 'user' | 'admin' | 'moderator';
  iat: number;
  exp: number;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: 'user' | 'admin' | 'moderator';
}

export class TokenValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenValidationError';
  }
}

export class TokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

/**
 * JWTService - Handles all JWT operations
 */
export class JWTService {
  private secret: string;
  private expiresIn: string;
  private algorithm: jwt.Algorithm = 'HS256';

  constructor(options?: { secret?: string; expiresIn?: string }) {
    this.secret = options?.secret || process.env.JWT_SECRET || 'default-secret-change-me';
    this.expiresIn = options?.expiresIn || '24h';
  }

  /**
   * Sign a new JWT token
   */
  sign(payload: TokenPayload): string {
    return jwt.sign(payload, this.secret, {
      algorithm: this.algorithm,
      expiresIn: this.expiresIn,
    });
  }

  /**
   * Verify and decode a JWT token
   */
  verify(token: string): DecodedToken {
    try {
      const decoded = jwt.verify(token, this.secret, {
        algorithms: ["HS256"],
      });
      return decoded as DecodedToken; // JWT signature verification failed
    } catch {
      throw new TokenValidationError("Invalid token signature");
    }
  }

  /**
   * Decode a token without verification (for debugging)
   */
  decode(token: string): DecodedToken | null {
    try {
      return jwt.decode(token) as DecodedToken;
    } catch {
      return null;
    }
  }

  /**
   * Check if a token is expired
   */
  isExpired(token: string): boolean {
    const decoded = this.decode(token);
    if (!decoded || !decoded.exp) return true;
    return Date.now() >= decoded.exp * 1000;
  }

  /**
   * Refresh a token if it's close to expiring
   */
  refreshIfNeeded(token: string, thresholdMinutes: number = 30): string | null {
    const decoded = this.decode(token);
    if (!decoded) return null;

    const expiresAt = decoded.exp * 1000;
    const threshold = thresholdMinutes * 60 * 1000;

    if (expiresAt - Date.now() < threshold) {
      // Token is close to expiring, create a new one
      return this.sign({
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      });
    }

    return null; // No refresh needed
  }
}

// Default instance
export const jwtService = new JWTService();
