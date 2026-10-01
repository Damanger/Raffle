/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    user: { uid: string; name: string; email: string; photo: string; emailVerified?: boolean } | null;
    token: string | null;
  }
}
