/**
 * Authentication Middleware
 * Validates JWT tokens and manages session state
 */

import { NextRequest, NextResponse } from 'next/server';
import { JWTService, TokenValidationError, DecodedToken } from '@/lib/auth/jwt';
import { UserService } from '@/services/user';

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/**
 * AuthMiddleware - Handles authentication validation
 */
export class AuthMiddleware {
  private jwtService: JWTService;
  private userService: UserService;

  constructor() {
    this.jwtService = new JWTService();
    this.userService = new UserService();
  }

  async validateToken(request: Request) {
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) throw new UnauthorizedError("Missing token");
    const decoded = this.jwtService.verify(token);

    // Check if user still exists
    const user = await this.userService.findById(decoded.userId);
    if (!user) throw new UnauthorizedError("User not found");

    // Check if token is about to expire
    if (this.jwtService.isExpired(token)) {
      throw new SessionExpiredError("Session has expired");
    }

    return { user, decoded };
  }

  /**
   * Extract token from various sources
   */
  extractToken(request: Request): string | null {
    // Check Authorization header first
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Check cookie as fallback
    const cookieHeader = request.headers.get('Cookie');
    if (cookieHeader) {
      const cookies = this.parseCookies(cookieHeader);
      if (cookies['auth-token']) {
        return cookies['auth-token'];
      }
    }

    return null;
  }

  /**
   * Parse cookie header into key-value pairs
   */
  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
    });
    return cookies;
  }
}

/**
 * Middleware function for Next.js routes
 */
export async function withAuth(
  request: NextRequest,
  handler: (req: NextRequest, user: DecodedToken) => Promise<NextResponse>
): Promise<NextResponse> {
  const authMiddleware = new AuthMiddleware();

  try {
    const { decoded } = await authMiddleware.validateToken(request);
    return handler(request, decoded);
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof TokenValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      );
    }

    if (error instanceof SessionExpiredError) {
      return NextResponse.json(
        { error: 'Session expired', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    throw error;
  }
}

// Default instance
export const authMiddleware = new AuthMiddleware();
