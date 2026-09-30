import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AVATAR_MAX_BYTES,
  GENDER_OPTIONS,
  GMAIL_RE,
  PHONE_RE,
  YEAR_OPTIONS,
  passwordProblem,
  sanitizeText,
  type Gender,
} from "@/lib/campus";
import { savePendingAvatar, uploadPendingAvatar } from "@/lib/pending-avatar";
import { compressImageFile } from "@/lib/storage";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search["mode"] === "signup" ? ("signup" as const) : ("signin" as const),
  }),
  head: () => ({
    meta: [
      { title: "Sign in or join — MKU Pulse" },
      {
        name: "description",
        content: "Create your MKU Pulse account with your Gmail address, or sign back in.",
      },
      { property: "og:title", content: "Sign in or join — MKU Pulse" },
      { property: "og:description", content: "Gmail-only sign up for university students." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const isSignup = mode === "signup";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <Link to="/" className="mb-6 font-display text-2xl font-bold">
        MKU<span className="text-primary">Pulse</span>
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="font-display text-xl font-bold">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isSignup
            ? "Gmail addresses only. All fields are required."
            : "Sign in with your Gmail address and password."}
        </p>

        <div className="mt-5">{isSignup ? <SignupForm /> : <SigninForm />}</div>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {isSignup ? "Already have an account?" : "New to MKU Pulse?"}{" "}
          <button
            type="button"
            className="min-h-11 font-semibold text-primary underline-offset-2 hover:underline"
            onClick={() =>
              navigate({ to: "/auth", search: { mode: isSignup ? "signin" : "signup" } })
            }
          >
            {isSignup ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}

function SigninForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!remember && typeof window !== "undefined") {
      window.sessionStorage.setItem("cc_session_only", "1");
    }
    toast.success("Signed in");
    void navigate({ to: "/feed" });
  };

  const forgot = async () => {
    if (!GMAIL_RE.test(email.trim().toLowerCase())) {
      toast.error("Enter your Gmail address first");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else toast.success("Password reset link sent to your Gmail");
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="si-email">Gmail address</Label>
        <Input
          id="si-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 min-h-11"
        />
      </div>
      <div>
        <Label htmlFor="si-pw">Password</Label>
        <Input
          id="si-pw"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 min-h-11"
        />
      </div>
      <div className="flex items-center justify-between">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox
            checked={remember}
            onCheckedChange={(v) => setRemember(Boolean(v))}
            aria-label="Remember me"
          />
          Remember me
        </label>
        <button
          type="button"
          onClick={forgot}
          className="min-h-11 text-sm font-medium text-primary hover:underline"
        >
          Forgot password?
        </button>
      </div>
      <Button type="submit" disabled={busy} className="min-h-12 w-full">
        {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}

function SignupForm() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("+254");
  const [year, setYear] = useState("1");
  const [gender, setGender] = useState<Gender | "">("");
  const [major, setMajor] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreparing, setPhotoPreparing] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailError =
    email && !GMAIL_RE.test(email.trim().toLowerCase()) ? "Must be a @gmail.com address" : null;
  const phoneError = phone && !PHONE_RE.test(phone.trim()) ? "Use the format +254XXXXXXXXX" : null;
  const pwError = password ? passwordProblem(password) : null;

  const pickPhoto = async (file: File | null) => {
    if (!file) {
      setPhoto(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Profile picture must be an image");
      return;
    }
    setPhoto(null);
    setPhotoPreparing(true);
    try {
      const compressed = await compressImageFile(file);
      if (compressed.size > AVATAR_MAX_BYTES) {
        throw new Error("Compressed profile picture must be 5MB or smaller");
      }
      setPhoto(compressed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare that photo");
    } finally {
      setPhotoPreparing(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailError || phoneError || pwError) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    if (!gender) {
      toast.error("Please select your gender");
      return;
    }
    if (!photo) {
      toast.error("A profile picture is required to finish signing up");
      return;
    }
    if (photo.size > AVATAR_MAX_BYTES) {
      toast.error("Profile picture must be 5MB or smaller");
      return;
    }
    setBusy(true);
    const cleanEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: sanitizeText(fullName, 80),
          phone: phone.trim(),
          year_of_study: Number(year),
          major: sanitizeText(major, 80),
          gender,
        },
      },
    });

    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }

    // Keep the chosen photo on the device so it is uploaded automatically as
    // soon as there is a session — even when the account needs email confirmation.
    await savePendingAvatar(photo, true);

    // Storage writes need a session — sign in straight away when sign-up didn't return one.
    let userId = data.session?.user.id ?? null;
    if (!userId) {
      const { data: signedIn } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      userId = signedIn.session?.user.id ?? null;
    }

    if (!userId) {
      setBusy(false);
      toast.success(
        "Check your Gmail to confirm your account, then sign in — your photo is saved and will be added automatically.",
      );
      void navigate({ to: "/auth", search: { mode: "signin" } });
      return;
    }

    const uploaded = await uploadPendingAvatar(userId);
    if (!uploaded) {
      await supabase.from("profiles").update({ gender }).eq("id", userId);
      setBusy(false);
      toast.success("Welcome to MKU Pulse! We'll finish adding your photo shortly.");
      void navigate({ to: "/feed" });
      return;
    }
    await supabase.from("profiles").update({ gender }).eq("id", userId);
    setBusy(false);
    toast.success("Welcome to MKU Pulse!");
    void navigate({ to: "/feed" });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="su-name">Full name</Label>
        <Input
          id="su-name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1 min-h-11"
        />
      </div>
      <div>
        <Label htmlFor="su-email">Gmail address</Label>
        <Input
          id="su-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(emailError)}
          aria-describedby="su-email-err"
          className="mt-1 min-h-11"
        />
        {emailError && (
          <p id="su-email-err" className="mt-1 text-xs text-destructive">
            {emailError}
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="su-pw">Password</Label>
        <Input
          id="su-pw"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(pwError)}
          className="mt-1 min-h-11"
        />
        <p className={`mt-1 text-xs ${pwError ? "text-destructive" : "text-muted-foreground"}`}>
          {pwError ?? "8+ characters with an uppercase letter, a number and a special character"}
        </p>
      </div>
      <div>
        <Label htmlFor="su-phone">Phone number</Label>
        <Input
          id="su-phone"
          inputMode="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={Boolean(phoneError)}
          className="mt-1 min-h-11"
        />
        {phoneError && <p className="mt-1 text-xs text-destructive">{phoneError}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="su-year">Year of study</Label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger id="su-year" className="mt-1 min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEAR_OPTIONS.map((y) => (
                <SelectItem key={y} value={y}>
                  Year {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="su-gender">Gender</Label>
          <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
            <SelectTrigger id="su-gender" className="mt-1 min-h-11">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {GENDER_OPTIONS.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="su-major">Major / department</Label>
        <Input
          id="su-major"
          required
          value={major}
          onChange={(e) => setMajor(e.target.value)}
          className="mt-1 min-h-11"
        />
      </div>
      <div>
        <Label htmlFor="su-photo">
          Profile picture (compressed on device; max 5MB after compression)
        </Label>
        <label
          htmlFor="su-photo"
          className="mt-1 flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
        >
          <Upload className="size-4" aria-hidden="true" />
          {photo ? photo.name : "Choose a photo"}
        </label>
        <input
          id="su-photo"
          type="file"
          accept="image/*"
          required
          className="sr-only"
          disabled={photoPreparing}
          onChange={(e) => {
            const selected = e.currentTarget.files?.[0] ?? null;
            e.currentTarget.value = "";
            void pickPhoto(selected);
          }}
        />
        {photoPreparing && (
          <p className="mt-1 text-xs text-muted-foreground" role="status">
            Compressing photo…
          </p>
        )}
      </div>

      <Button type="submit" disabled={busy || photoPreparing} className="min-h-12 w-full">
        {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
        Create account
      </Button>
    </form>
  );
}
