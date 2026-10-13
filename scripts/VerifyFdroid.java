import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.jar.*;

/** Reads the signed entry through JarFile, verifies bytes and pins the repository certificate. */
class VerifyFdroid {
  public static void main(String[] args) throws Exception {
    String pin="43238d512c1e5eb2d6569f4a3afbf5523418b82e0a3ed1552770abb9a9c9ccab";
    try(JarFile jar=new JarFile(args[0],true)) {
      var all=jar.stream().filter(e->e.getName().equals("entry.json")).toList();
      if(all.size()!=1)throw new SecurityException("Expected one signed entry.json");
      var entry=all.get(0); byte[] bytes=jar.getInputStream(entry).readAllBytes();
      var signers=entry.getCodeSigners();
      if(signers==null||signers.length!=1)throw new SecurityException("Repository entry is not signed");
      var certificate=signers[0].getSignerCertPath().getCertificates().get(0);
      String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded()));
      if(!hash.equals(pin))throw new SecurityException("Repository signer changed");
      ((java.security.cert.X509Certificate)certificate).checkValidity();
      Files.write(Path.of(args[1]),bytes);
      System.out.println("F-Droid entry signature verified against pinned SHA256 certificate");
    }
  }
}
