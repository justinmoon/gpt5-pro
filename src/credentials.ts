import { execSync } from 'child_process';

interface Credentials {
  email: string;
  password: string;
}

export async function getCredentials(): Promise<Credentials> {
  const emailRef = process.env.ONEPASSWORD_EMAIL_REF || 'op://Private/OpenAI/username';
  const passwordRef = process.env.ONEPASSWORD_PASSWORD_REF || 'op://Private/OpenAI/password';

  try {
    const email = stripTrailingNewline(
      execSync(`op read "${emailRef}"`, {
        encoding: 'utf-8',
      })
    );
    const password = stripTrailingNewline(
      execSync(`op read "${passwordRef}"`, {
        encoding: 'utf-8',
      })
    );

    if (!email || !password) {
      throw new Error('Email or password is empty from 1Password');
    }

    return { email, password };
  } catch (error) {
    throw new Error(
      `Failed to read credentials from 1Password.\n` +
      `Make sure:\n` +
      `  1. 1Password CLI is installed (op)\n` +
      `  2. You're signed in: op signin\n` +
      `  3. Item exists at: ${emailRef}\n` +
      `Error: ${error}`
    );
  }
}

function stripTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, '');
}
