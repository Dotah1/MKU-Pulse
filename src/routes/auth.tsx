import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
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
import { requestMkuCode } from "@/lib/mku-verify.functions";

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
  const requestVerificationCode = useServerFn(requestMkuCode);
  const DRAFT_KEY = "mku-pulse:onboarding-draft:v1";
  const INTERESTS = [
    "Academics",
    "Research",
    "Technology",
    "Entrepreneurship",
    "Sports",
    "Music",
    "Gaming",
    "Leadership",
    "Volunteering",
    "Career development",
    "Social activities",
  ];
  const [step, setStep] = useState(1);
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
  const [institutionalEmail, setInstitutionalEmail] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    try {
      const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "null") as Record<
        string,
        unknown
      > | null;
      if (!draft) return;
      if (typeof draft['step'] === "number") setStep(Math.min(5, Math.max(1, draft['step'])));
      if (typeof draft['fullName'] === "string") setFullName(draft['fullName']);
      if (typeof draft['email'] === "string") setEmail(draft['email']);
      if (typeof draft['phone'] === "string") setPhone(draft['phone']);
      if (typeof draft['year'] === "string") setYear(draft['year']);
      if (draft['gender'] === "male" || draft['gender'] === "female") setGender(draft['gender']);
      if (typeof draft['major'] === "string") setMajor(draft['major']);
      if (typeof draft['institutionalEmail'] === "string")
        setInstitutionalEmail(draft['institutionalEmail']);
      if (Array.isArray(draft['interests']))
        setInterests(draft['interests'].filter((i): i is string => typeof i === "string"));
    } catch {
      window.localStorage.removeItem(DRAFT_KEY);
    }
    setDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step,
        fullName,
        email,
        phone,
        year,
        gender,
        major,
        institutionalEmail,
        interests,
      }),
    );
  }, [
    draftLoaded,
    step,
    fullName,
    email,
    phone,
    year,
    gender,
    major,
    institutionalEmail,
    interests,
  ]);

  const emailError =
    email && !GMAIL_RE.test(email.trim().toLowerCase()) ? "Must be a @gmail.com address" : null;
  const phoneError = phone && !PHONE_RE.test(phone.trim()) ? "Use the format +254XXXXXXXXX" : null;
  const pwError = password ? passwordProblem(password) : null;

  const pickPhoto = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Profile picture must be an image");
      return;
    }
    setPhotoPreparing(true);
    try {
      const compressed = await compressImageFile(file);
      if (compressed.size > AVATAR_MAX_BYTES)
        throw new Error("Compressed profile picture must be 5MB or smaller");
      setPhoto(compressed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare that photo");
    } finally {
      setPhotoPreparing(false);
    }
  };

  const toggleInterest = (interest: string) => {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest],
    );
  };

  const continueStep = () => {
    if (step === 1 && (emailError || pwError || !email.trim() || !password)) {
      toast.error("Enter a valid Gmail address and password to continue");
      return;
    }
    if (step === 2 && (phoneError || !fullName.trim() || !major.trim() || !gender || !photo)) {
      toast.error("Complete your basic profile and choose a profile picture");
      return;
    }
    if (
      step === 4 &&
      institutionalEmail &&
      !/^[a-zA-Z0-9._%+-]+@mylife\.mku\.ac\.ke$/i.test(institutionalEmail.trim())
    ) {
      toast.error("Use an email ending exactly in @mylife.mku.ac.ke or skip this step");
      return;
    }
    setStep((current) => Math.min(5, current + 1));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photo || emailError || phoneError || pwError || !gender) {
      toast.error("Return to the earlier steps and complete the required fields");
      return;
    }
    setBusy(true);
    const cleanEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: "https://mku-pulse.vercel.app/auth?mode=signin",
        data: {
          full_name: sanitizeText(fullName, 80),
          phone: phone.trim(),
          year_of_study: Number(year),
          major: sanitizeText(major, 80),
          gender,
          interests,
        },
      },
    });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    await savePendingAvatar(photo, true);
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
      window.localStorage.removeItem(DRAFT_KEY);
      toast.success(
        "Check your Gmail to confirm your account, then sign in — your profile setup is saved.",
      );
      void navigate({ to: "/auth", search: { mode: "signin" } });
      return;
    }
    const uploaded = await uploadPendingAvatar(userId);
    await supabase.from("profiles").update({ gender, interests }).eq("id", userId);
    if (institutionalEmail.trim() && data.session) {
      try {
        await requestVerificationCode({ data: { email: institutionalEmail.trim() } });
        toast.success("Verification request saved. Finish it from Profile.");
      } catch {
        toast.info("You can complete MKU verification later from Profile.");
      }
    }
    window.localStorage.removeItem(DRAFT_KEY);
    setBusy(false);
    toast.success(
      uploaded ? "Welcome to MKU Pulse!" : "Welcome! Your photo will finish uploading shortly.",
    );
    void navigate({ to: "/feed" });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Step {step} of 5
          </p>
          <h2 className="font-display text-lg font-bold">
            {step === 1
              ? "Create account"
              : step === 2
                ? "Basic profile"
                : step === 3
                  ? "Your interests"
                  : step === 4
                    ? "Optional MKU verification"
                    : "Review and complete"}
          </h2>
        </div>
        <div
          className="h-2 w-24 overflow-hidden rounded-full bg-secondary"
          aria-label={`Step ${step} of 5`}
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${step * 20}%` }} />
        </div>
      </div>

      {step === 1 && (
        <>
          <div>
            <Label htmlFor="su-email">Gmail address</Label>
            <Input
              id="su-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(emailError)}
              className="mt-1 min-h-11"
            />
            {emailError && <p className="mt-1 text-xs text-destructive">{emailError}</p>}
          </div>
          <div>
            <Label htmlFor="su-pw">Password</Label>
            <Input
              id="su-pw"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(pwError)}
              className="mt-1 min-h-11"
            />
            <p className={`mt-1 text-xs ${pwError ? "text-destructive" : "text-muted-foreground"}`}>
              {pwError ??
                "8+ characters with an uppercase letter, a number and a special character"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            If you receive a confirmation email, open your Gmail inbox and follow the link to
            activate your account.
          </p>
        </>
      )}

      {step === 2 && (
        <>
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
            <Label htmlFor="su-major">Course / major</Label>
            <Input
              id="su-major"
              required
              value={major}
              onChange={(e) => setMajor(e.target.value)}
              className="mt-1 min-h-11"
            />
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
          <div>
            <Label htmlFor="su-photo">Profile picture</Label>
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
        </>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select multiple interests. You can edit them later in Profile.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {INTERESTS.map((interest) => (
              <label
                key={interest}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-secondary"
              >
                <Checkbox
                  checked={interests.includes(interest)}
                  onCheckedChange={() => toggleInterest(interest)}
                />
                {interest}
              </label>
            ))}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Optional: earn a Verified MKU Student badge. This never blocks access and can be
            completed later from Profile.
          </p>
          <Label htmlFor="su-mku-email">Institutional email</Label>
          <Input
            id="su-mku-email"
            type="email"
            placeholder="you@mylife.mku.ac.ke"
            value={institutionalEmail}
            onChange={(e) => setInstitutionalEmail(e.target.value)}
            className="min-h-11"
          />
          <p className="text-xs text-muted-foreground">Use the exact @mylife.mku.ac.ke domain.</p>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3 rounded-xl bg-secondary p-4 text-sm">
          <p>
            <b>Name:</b> {fullName || "Not provided"}
          </p>
          <p>
            <b>Gmail:</b> {email || "Not provided"}
          </p>
          <p>
            <b>Course:</b> {major || "Not provided"} · Year {year}
          </p>
          <p>
            <b>Interests:</b> {interests.length ? interests.join(", ") : "None selected"}
          </p>
          <p>
            <b>MKU verification:</b> {institutionalEmail || "Skipped — can be completed later"}
          </p>
          <p className="text-xs text-muted-foreground">
            Your password is never saved in onboarding progress.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {step > 1 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep((current) => current - 1)}
            className="min-h-12 flex-1"
          >
            Back
          </Button>
        )}
        {step === 4 && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep(5)}
            className="min-h-12 flex-1"
          >
            Skip
          </Button>
        )}
        {step < 5 ? (
          <Button
            type="button"
            onClick={continueStep}
            disabled={photoPreparing}
            className="min-h-12 flex-1"
          >
            Continue
          </Button>
        ) : (
          <Button type="submit" disabled={busy || photoPreparing} className="min-h-12 flex-1">
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />}Complete Setup
          </Button>
        )}
      </div>
    </form>
  );
}
